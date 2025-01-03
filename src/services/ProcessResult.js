const { RecursiveCharacterTextSplitter } = require('langchain/text_splitter');
const { getPersona, determineConversationType } = require('./persona');

class ProcessResult {
    constructor(config = {}) {
        this.similarityThreshold = config.similarityThreshold || 0.5;
        this.maxContextLength = config.maxContextLength || 3000;
        this.minRelevantChunks = config.minRelevantChunks || 1;
        this.chunkSize = config.chunkSize || 500;
        this.chunkOverlap = config.chunkOverlap || 50;
        
        this.textSplitter = new RecursiveCharacterTextSplitter({
            chunkSize: this.chunkSize,
            chunkOverlap: this.chunkOverlap,
        });
    }

    processSearchResults(searchResults) {
        if (!searchResults || !searchResults.matches) {
            console.log('No search results to process');
            return {
                context: '',
                sources: [],
                totalMatches: 0,
                relevantMatches: 0
            };
        }

        console.log(`Processing ${searchResults.matches.length} search results...`);

        // Filter results by similarity threshold
        const relevantMatches = searchResults.matches.filter(
            match => match.score >= this.similarityThreshold
        );

        console.log(`Found ${relevantMatches.length} relevant matches above threshold ${this.similarityThreshold}`);

        // If we don't have enough relevant matches, include more results
        let finalMatches = relevantMatches;
        if (relevantMatches.length < this.minRelevantChunks) {
            console.log(`Not enough relevant matches, including top ${this.minRelevantChunks} results`);
            finalMatches = searchResults.matches.slice(0, this.minRelevantChunks);
        }

        // Extract and format the context and sources
        const { context, sources } = this.formatResults(finalMatches);

        console.log(`Generated context length: ${context.length} characters`);
        console.log(`Number of sources: ${sources.length}`);

        return {
            context,
            sources,
            totalMatches: searchResults.matches.length,
            relevantMatches: finalMatches.length
        };
    }

    formatResults(matches) {
        let context = '';
        const sources = [];
        let currentLength = 0;

        for (const match of matches) {
            if (!match.metadata || !match.metadata.text) continue;

            const text = match.metadata.text;
            const source = {
                id: match.id,
                score: match.score,
                metadata: { ...match.metadata }
            };

            // Check if adding this text would exceed maxContextLength
            if (currentLength + text.length <= this.maxContextLength) {
                context += (context ? '\n\n' : '') + text;
                currentLength += text.length;
                sources.push(source);
            } else {
                // If the context is too long, split it into smaller chunks
                const remainingLength = this.maxContextLength - currentLength;
                if (remainingLength > 100) { // Only add if we can fit a meaningful chunk
                    const truncatedText = text.substring(0, remainingLength);
                    context += (context ? '\n\n' : '') + truncatedText;
                    source.metadata.text = truncatedText;
                    sources.push(source);
                }
                break;
            }
        }

        return { context, sources };
    }

    async createAnalysisPrompt(transcript, context, conversationType) {
        const persona = getPersona();
        
        const promptContent = conversationType === 'casual' 
            ? persona.casualPrompt 
            : persona.technicalPrompt;

        const basePrompt = `You are me - Jed McCaleb. I'm direct, honest, and straightforward in all conversations.

${promptContent}

Response Template (${conversationType}):
${conversationType === 'technical' ? 
    persona.responseTemplates.technical : 
    persona.responseTemplates.casual}

Remember: This is me speaking directly to someone, not about me in third person.`;

        // If no context is provided, create a prompt without it
        if (!context) {
            console.log('No context provided, generating direct response');
            const messages = [
                {
                    role: 'system',
                    content: basePrompt
                },
                {
                    role: 'user',
                    content: conversationType === 'technical' 
                        ? `Question for me: ${transcript}\n\nKeep the response focused and brief, highlighting only the most important points.`
                        : `Question for me: ${transcript}`
                }
            ];

            return {
                messages,
                temperature: conversationType === 'casual' ? 0.7 : persona.temperature,
                maxTokens: persona.maxTokens,
                presencePenalty: persona.presencePenalty,
                frequencyPenalty: persona.frequencyPenalty,
                topP: persona.topP
            };
        }

        // Handle context if provided (keeping existing functionality)
        const contextChunks = await this.textSplitter.createDocuments([context]);
        let combinedContext = '';
        for (const chunk of contextChunks) {
            if (combinedContext.length + chunk.pageContent.length <= this.maxContextLength) {
                combinedContext += (combinedContext ? '\n\n' : '') + chunk.pageContent;
            } else {
                break;
            }
        }

        console.log(`Combined context length: ${combinedContext.length} characters`);

        const messages = [
            {
                role: 'system',
                content: basePrompt
            },
            {
                role: 'user',
                content: conversationType === 'technical'
                    ? `Context: ${combinedContext}\n\nQuestion for me: ${transcript}\n\nKeep the response focused and brief, highlighting only the most important points.`
                    : `Question for me: ${transcript}`
            }
        ];

        return {
            messages,
            temperature: conversationType === 'casual' ? 0.7 : persona.temperature,
            maxTokens: persona.maxTokens,
            presencePenalty: persona.presencePenalty,
            frequencyPenalty: persona.frequencyPenalty,
            topP: persona.topP
        };
    }

    async splitText(text) {
        return this.textSplitter.createDocuments([text]);
    }
}

module.exports = ProcessResult;