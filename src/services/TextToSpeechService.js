const { TextToSpeechClient } = require('@google-cloud/text-to-speech');
const fs = require('fs').promises;
const fsSync = require('fs');  // For sync operations
const path = require('path');
const AudioPlayer = require('./AudioPlayer');
const numberToWords = require('number-to-words');

class TextToSpeechService {
    constructor() {
        this.client = null;
        this.audioPlayer = new AudioPlayer({
            volume: 85  // Slightly lower default volume for comfort
        });
        this.outputDir = path.join(__dirname, '..', '..', 'audio_output');
        this.isInitialized = false;
        this.credentialsPath = path.join(__dirname, '..', 'creds', 'meetBot-credentials.json');
        
        // Voice settings for more natural speech
        this.voiceSettings = {
            languageCode: 'en-US',
            name: 'en-US-Neural2-D',  // Male voice with natural intonation
            ssmlGender: 'MALE'
        };
        
        // Audio settings for better quality
        this.audioConfig = {
            audioEncoding: 'MP3',
            speakingRate: 1.1,        // Slightly faster for engagement
            pitch: -0.5,              // Slightly lower pitch for male voice
            volumeGainDb: 1.0,        // Slight volume boost
            effectsProfileId: ['small-bluetooth-speaker-class-device']  // Optimize for speakers
        };

        this.isSpeaking = false;
        this.audioService = null;
        this.onSpeakingStateChange = null;
    }

    async initialize() {
        try {
            // Ensure output directory exists
            await fs.mkdir(this.outputDir, { recursive: true });
            
            try {
                // Initialize with credentials file path
                this.client = new TextToSpeechClient({
                    keyFilename: this.credentialsPath
                });
                this.isInitialized = true;
                console.log('Text-to-speech service initialized with credentials from:', this.credentialsPath);
            } catch (error) {
                console.warn('Failed to initialize Google Cloud Text-to-Speech:', error.message);
                this.isInitialized = false;
            }
        } catch (error) {
            console.error('Error initializing text-to-speech service:', error);
            throw error;
        }
    }

    setAudioService(audioService) {
        this.audioService = audioService;
    }

    async synthesizeAndPlay(text) {
        try {
            this.isSpeaking = true;
            // Notify about speaking state
            if (this.onSpeakingStateChange) {
                this.onSpeakingStateChange(true);
            }

            // Store the response in AudioService for feedback prevention
            if (this.audioService) {
                this.audioService.storeResponse(text);
            }

            if (!this.isInitialized) {
                throw new Error('Text-to-speech service not initialized');
            }

            // Prepare the text for better speech synthesis
            const preparedText = this.prepareTextForSpeech(text);

            // Split text into manageable chunks if needed
            const chunks = this.splitTextIntoChunks(preparedText);
            
            for (const chunk of chunks) {
                const request = {
                    input: { ssml: `<speak>${chunk}</speak>` },
                    voice: this.voiceSettings,
                    audioConfig: this.audioConfig
                };

                const [response] = await this.client.synthesizeSpeech(request);
                const audioFilename = `speech_${Date.now()}.mp3`;
                const audioPath = path.join(this.outputDir, audioFilename);

                await fs.writeFile(audioPath, response.audioContent, 'binary');
                await this.audioPlayer.playAudio(audioPath);

                // Clean up the file after playing
                await fs.unlink(audioPath).catch(console.error);
            }

            this.isSpeaking = false;
            if (this.onSpeakingStateChange) {
                this.onSpeakingStateChange(false);
            }
        } catch (error) {
            this.isSpeaking = false;
            if (this.onSpeakingStateChange) {
                this.onSpeakingStateChange(false);
            }
            console.error('Error synthesizing or playing speech:', error);
            throw error;
        }
    }

    /**
     * Convert a number to words, with error handling
     * @private
     * @param {string} num - Number to convert
     * @returns {string} Number in words or original number if conversion fails
     */
    numberToWords(num) {
        try {
            const number = parseInt(num);
            if (isNaN(number)) return num;
            
            // Only convert reasonable numbers to words
            if (number > 9999 || number < -9999) return num;
            
            const words = require('number-to-words');
            return words.toWords(number);
        } catch (error) {
            console.warn('Error converting number to words:', error);
            return num;
        }
    }

    /**
     * Prepare text for speech synthesis by improving its structure and formatting
     * @param {string} text - The text to prepare
     * @returns {string} Prepared text
     */
    prepareTextForSpeech(text) {
        if (!text) return '';

        // Remove any special characters that might affect speech
        text = text.replace(/[*_~`#]/g, '');

        // Add pauses after sentences
        text = text.replace(/\.\s+/g, '. <break time="500ms"/> ');
        text = text.replace(/\?\s+/g, '? <break time="500ms"/> ');
        text = text.replace(/!\s+/g, '! <break time="500ms"/> ');

        // Add slight pauses for commas and semicolons
        text = text.replace(/,\s+/g, ', <break time="200ms"/> ');
        text = text.replace(/;\s+/g, '; <break time="300ms"/> ');

        // Convert numbers to words for better pronunciation
        text = text.replace(/\b\d+\b/g, (match) => this.numberToWords(match));

        // Add emphasis to key phrases
        const emphasisPhrases = [
            'important',
            'urgent',
            'critical',
            'deadline',
            'action item',
            'decision made',
            'next steps'
        ];
        
        emphasisPhrases.forEach(phrase => {
            const regex = new RegExp(`\\b${phrase}\\b`, 'gi');
            text = text.replace(regex, `<emphasis level="moderate">${phrase}</emphasis>`);
        });

        // Clean up any double spaces or unnecessary whitespace
        text = text.replace(/\s+/g, ' ').trim();

        return text;
    }

    splitTextIntoChunks(text) {
        // Split text into manageable chunks if needed
        const chunks = text.match(/[^.!?]+[.!?]+/g) || [text];
        return chunks;
    }

    async handleLongText(text) {
        // Split text into smaller chunks at sentence boundaries
        const chunks = text.match(/[^.!?]+[.!?]+/g) || [text];
        
        for (const chunk of chunks) {
            if (chunk.trim()) {
                await this.synthesizeAndPlay(chunk);
            }
        }
    }

    async cleanupOldFiles() {
        try {
            // Keep only the 5 most recent files
            const files = await fs.readdir(this.outputDir);
            const audioFiles = await Promise.all(
                files.filter(f => f.endsWith('.mp3'))
                     .map(async f => {
                         const filePath = path.join(this.outputDir, f);
                         const stats = await fs.stat(filePath);
                         return { name: f, time: stats.mtime };
                     })
            );
            
            // Sort by modification time
            audioFiles.sort((a, b) => b.time - a.time);

            // Delete older files
            for (let i = 5; i < audioFiles.length; i++) {
                const filePath = path.join(this.outputDir, audioFiles[i].name);
                await fs.unlink(filePath);
                console.log('Cleaned up old audio file:', audioFiles[i].name);
            }
        } catch (error) {
            console.warn('Error cleaning up old files:', error);
        }
    }

    /**
     * Clean up resources and stop any ongoing playback
     */
    async cleanup() {
        try {
            if (this.audioPlayer) {
                await this.audioPlayer.stopAudio();
            }
            await this.cleanupOldFiles();
        } catch (error) {
            console.error('Error during cleanup:', error);
        }
    }

    async stop() {
        if (this.audioPlayer) {
            await this.audioPlayer.stopAudio();
        }
    }

    setOnSpeakingStateChange(callback) {
        this.onSpeakingStateChange = callback;
    }
}

module.exports = TextToSpeechService;
