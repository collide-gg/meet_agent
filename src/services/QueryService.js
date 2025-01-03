const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');
const { Pinecone } = require('@pinecone-database/pinecone');
const { OpenAIEmbeddings } = require('langchain/embeddings/openai');
const dotenv = require('dotenv');
const ProcessResult = require('./ProcessResult');
const TextToSpeechService = require('./TextToSpeechService');

dotenv.config();

class QueryService {
    constructor(options = {}) {
        this.queryDir = path.join(__dirname, '..', '..', 'query');
        this.queryFile = path.join(this.queryDir, 'query.txt');
        this.analysisDir = path.join(this.queryDir, 'analysis');
        
        // Initialize configuration
        this.config = {
            useTTS: options.useTTS !== undefined ? options.useTTS : true,
            ...options
        };

        // Initialize OpenAI
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });

        // Initialize OpenAI embeddings
        this.embeddings = new OpenAIEmbeddings({
            openAIApiKey: process.env.OPENAI_API_KEY,
        });
        
        // Initialize ProcessResult with default settings
        this.processor = new ProcessResult({
            similarityThreshold: 0.5,
            maxContextLength: 3000,
            minRelevantChunks: 1,
            chunkSize: 500,
            chunkOverlap: 50
        });

        // Conditionally initialize text-to-speech service
        if (!options.skipTTS) {
            this.ttsService = new TextToSpeechService();
            this.ttsService.setOnSpeakingStateChange((speaking) => {
                this.isSpeaking = speaking;
                // Notify AudioService about TTS state
                if (this.audioService) {
                    this.audioService.setTTSState(speaking);
                }
            });
        }

        // Initialize Pinecone configuration
        this.queryConfig = {
            topK: 5,
            includeValues: true,
            includeMetadata: true
        };

        this.isSpeaking = false;
        this.audioService = null;
    }

    setAudioService(audioService) {
        this.audioService = audioService;
        // Connect AudioService to TTS service if it exists
        if (this.ttsService) {
            this.ttsService.setAudioService(audioService);
        }
    }

    async initialize() {
        try {
            // Create query directory if it doesn't exist
            if (!fs.existsSync(this.queryDir)) {
                fs.mkdirSync(this.queryDir, { recursive: true });
                console.log('Created query directory');
            }

            // Create analysis directory if it doesn't exist
            if (!fs.existsSync(this.analysisDir)) {
                fs.mkdirSync(this.analysisDir, { recursive: true });
                console.log('Created analysis directory');
            }

            // Don't overwrite query file if it exists
            if (!fs.existsSync(this.queryFile)) {
                fs.writeFileSync(this.queryFile, '');
                console.log('Created empty query file');
            }

            // Initialize Pinecone
            console.log('Initializing Pinecone...');
            this.pinecone = new Pinecone({
                apiKey: process.env.PINECONE_API_KEY,
            });

            if (!process.env.PINECONE_INDEX_NAME) {
                throw new Error('PINECONE_INDEX_NAME environment variable is not set');
            }

            this.index = this.pinecone.Index(process.env.PINECONE_INDEX_NAME);
            console.log('Pinecone initialized successfully');

            // Conditionally initialize text-to-speech service
            if (this.ttsService) {
                console.log('Initializing text-to-speech service...');
                await this.ttsService.initialize();
                console.log('Text-to-speech service initialized');
            }
            
            return true;
        } catch (error) {
            console.error('Error initializing QueryService:', error);
            throw error;
        }
    }

    getMostRecentTranscript() {
        try {
            if (!fs.existsSync(this.queryFile)) {
                console.log('Query file does not exist');
                return null;
            }

            const content = fs.readFileSync(this.queryFile, 'utf8');
            if (!content) {
                console.log('Query file is empty');
                return null;
            }

            // Split content into entries
            const entries = content.split('\n\n').filter(entry => entry.trim());
            if (entries.length === 0) {
                console.log('No entries found in query file');
                return null;
            }

            // Get the most recent final transcript
            for (let i = entries.length - 1; i >= 0; i--) {
                const entry = entries[i];
                const lines = entry.split('\n');
                if (lines.length >= 2) {
                    const firstLine = lines[0];
                    const matches = firstLine.match(/\[(.*?)\] \[(FINAL|INTERIM)\] \(confidence: ([\d.]+)%\)/);
                    
                    if (matches && matches[2] === 'FINAL') {
                        console.log('Found most recent final transcript');
                        return lines.slice(1).join('\n').trim();
                    }
                }
            }

            console.log('No final transcript found');
            return null;
        } catch (error) {
            console.error('Error getting most recent transcript:', error);
            return null;
        }
    }

    async queryWithRecentTranscript() {
        try {
            const transcript = this.getMostRecentTranscript();
            if (!transcript) {
                console.log('No recent transcript found');
                return null;
            }

            console.log('Processing recent transcript:', transcript);
            return await this.processQuery(transcript);
        } catch (error) {
            console.error('Error processing recent transcript:', error);
            throw error;
        }
    }

    async determineConversationType(transcript) {
        try {
            console.log('Determining conversation type...');
            const response = await this.openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    {
                        role: "system",
                        content: `You are a conversation classifier. Your task is to determine if a given query is "technical" or "casual". 
Respond with only one word: either "technical" or "casual".

Consider the following:
- Technical queries typically involve detailed, specific, or complex topics that may require additional context or data.
- Casual queries are general, conversational, or simple, often not requiring additional data to respond.`
                    },
                    {
                        role: "user",
                        content: transcript
                    }
                ],
                temperature: 0.1,
                max_tokens: 10
            });

            const conversationType = response.choices[0].message.content.toLowerCase().trim();
            console.log(`Conversation type determined: ${conversationType}`);
            return conversationType === 'technical' ? 'technical' : 'casual';
        } catch (error) {
            console.error('Error determining conversation type:', error);
            return 'casual'; // Default to casual if classification fails
        }
    }

    async processQuery(transcript, context = null) {
        try {
            console.log('Processing query...');
            
            // Skip processing if we detect it's our own speech
            if (this.audioService && !this.audioService.shouldProcessAudio(transcript)) {
                console.log('Skipping query processing - detected potential feedback');
                return null;
            }
            
            // First, determine the conversation type
            const conversationType = await this.determineConversationType(transcript);
            console.log(`Conversation type: ${conversationType}`);

            // For technical queries, retrieve context from Pinecone if not provided
            if (conversationType === 'technical' && !context) {
                try {
                    console.log('Retrieving context from Pinecone...');
                    const queryEmbedding = await this.embeddings.embedQuery(transcript);
                    
                    // Use the index instance for querying
                    const searchResults = await this.index.query({
                        vector: queryEmbedding,
                        topK: this.queryConfig.topK,
                        includeValues: this.queryConfig.includeValues,
                        includeMetadata: this.queryConfig.includeMetadata
                    });
                    
                    context = this.processor.processSearchResults(searchResults).context;
                    console.log('Context retrieved from Pinecone');
                } catch (error) {
                    console.error('Error retrieving context from Pinecone:', error);
                }
            }

            // Get analysis prompt with conversation type and context
            const prompt = await this.processor.createAnalysisPrompt(transcript, context, conversationType);

            console.log('Sending request to OpenAI...');
            const response = await this.openai.chat.completions.create({
                model: "gpt-4",
                messages: prompt.messages,
                temperature: prompt.temperature,
                max_tokens: prompt.maxTokens,
                presence_penalty: prompt.presencePenalty,
                frequency_penalty: prompt.frequencyPenalty,
                top_p: prompt.topP
            });

            const analysis = response.choices[0].message.content;
            console.log(`Analysis generated successfully (${conversationType} response)`);
            
            // Save the analysis
            await this.saveAnalysis(transcript, analysis, context, conversationType);

            // Store the response for feedback prevention
            if (this.audioService) {
                console.log('Storing response for feedback prevention');
                this.audioService.storeResponse(analysis);
            }

            // Handle TTS if enabled
            if (this.config.useTTS && this.ttsService) {
                console.log('Converting analysis to speech...');
                try {
                    await this.ttsService.synthesizeAndPlay(analysis);
                } catch (error) {
                    console.error('Error in text-to-speech:', error);
                }
            }

            return analysis;

        } catch (error) {
            console.error('Error processing query:', error);
            throw error;
        }
    }

    async saveAnalysis(transcript, analysis, context, conversationType) {
        const analysisDir = path.join(this.queryDir, 'analysis');
        if (!fs.existsSync(analysisDir)) {
            fs.mkdirSync(analysisDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const analysisFile = path.join(analysisDir, `analysis_${timestamp}.json`);

        const analysisData = {
            timestamp,
            transcript,
            context,
            analysis,
            conversationType // Add conversation type to saved data
        };

        try {
            fs.writeFileSync(analysisFile, JSON.stringify(analysisData, null, 2));
            console.log(`Analysis saved to: ${analysisFile}`);
        } catch (error) {
            console.error('Error saving analysis:', error);
            throw error;
        }
    }

    async saveQuery(text, confidence, isFinal, timestamp = new Date().toISOString()) {
        // Ensure text is a string and not empty
        if (!text || typeof text !== 'string' || text.trim().length === 0) {
            console.log('Skipping empty or invalid transcript');
            return;
        }

        const confidenceStr = confidence ? ` (confidence: ${(confidence * 100).toFixed(2)}%)` : '';
        const finalityStr = isFinal ? '[FINAL]' : '[INTERIM]';
        const queryEntry = `${timestamp}\n${finalityStr}${confidenceStr}\n${text}\n\n`;

        try {
            // Append to query file
            fs.appendFileSync(this.queryFile, queryEntry);
            console.log(`Query saved successfully: ${text.substring(0, 50)}...`);

            // If it's a final transcript, process it asynchronously
            if (isFinal) {
                // Process the query without waiting for it to complete
                this.queryWithRecentTranscript().catch(error => {
                    console.error('Error processing query:', error);
                });
                return { status: 'processing' };
            }
            
            return { status: 'saved' };
        } catch (error) {
            console.error('Error saving query:', error);
            throw error;
        }
    }

    clearQueries() {
        try {
            console.log('Clearing query file...');
            if (fs.existsSync(this.queryFile)) {
                fs.writeFileSync(this.queryFile, '');
                console.log('Query file cleared successfully');
            }
        } catch (error) {
            console.error('Error clearing query file:', error);
            throw error;
        }
    }

    getQueries() {
        try {
            if (fs.existsSync(this.queryFile)) {
                return fs.readFileSync(this.queryFile, 'utf8');
            }
            return '';
        } catch (error) {
            console.error('Error reading queries:', error);
            throw error;
        }
    }

    getAnalyses() {
        const analysisDir = path.join(this.queryDir, 'analysis');
        try {
            if (!fs.existsSync(analysisDir)) {
                return [];
            }

            const files = fs.readdirSync(analysisDir);
            return files
                .filter(file => file.endsWith('.json'))
                .map(file => {
                    const content = fs.readFileSync(path.join(analysisDir, file), 'utf8');
                    return JSON.parse(content);
                })
                .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        } catch (error) {
            console.error('Error reading analyses:', error);
            throw error;
        }
    }

    async speak(text) {
        // Implement TTS functionality here
        // Ensure this method sets isSpeaking to true at the start and false at the end
        console.log('Speaking:', text);
        // Simulate TTS delay
        await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate TTS duration
    }

    async listenForTranscriptions() {
        if (this.isSpeaking) {
            console.log('Currently speaking, not listening for transcriptions.');
            return;
        }
        // Implement transcription listening logic here
        console.log('Listening for transcriptions...');
    }
}

module.exports = QueryService;