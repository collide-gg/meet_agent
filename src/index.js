require('dotenv').config();

const BrowserService = require('./services/BrowserService');
const AudioService = require('./services/AudioService');
const WatcherService = require('./services/WatcherService');
const QueryService = require('./services/QueryService');
const TextToSpeechService = require('./services/TextToSpeechService');

class MeetAgent {
    constructor() {
        this.isShuttingDown = false;
        this.shutdownTimeout = 10000; // 10 seconds timeout
        this.browserService = BrowserService;

        // Initialize services
        this.ttsService = new TextToSpeechService();
        this.queryService = new QueryService({
            useTTS: true,
            ttsService: this.ttsService,
            skipTTS: false  // Ensure TTS is enabled
        });
        
        // Initialize AudioService with transcript handler
        this.audioService = new AudioService();
        
        // Initialize WatcherService
        this.watcherService = new WatcherService();

        // Connect services for feedback prevention
        this.queryService.setAudioService(this.audioService);
        this.ttsService.setAudioService(this.audioService);

        // Set up TTS state change callback
        this.ttsService.onSpeakingStateChange = (isSpeaking) => {
            this.audioService.setTTSState(isSpeaking);
        };
    }

    async start() {
        try {
            console.log('Initializing services...');
            
            // Initialize core services
            console.log('Initializing TTS service...');
            await this.ttsService.initialize();
            
            console.log('Initializing query service...');
            await this.queryService.initialize();
            
            // Initialize browser and join meeting
            console.log('Initializing browser...');
            await this.browserService.initializeBrowser();
            
            // Get meeting URL from environment
            const meetUrl = process.env.MEET_URL;
            if (!meetUrl) {
                throw new Error('MEET_URL not found in environment variables');
            }

            // Sign in to Google and join meeting
            console.log('Signing in to Google...');
            await this.browserService.signInToGoogle();
            
            console.log('Joining meeting:', meetUrl);
            await this.browserService.joinMeeting(meetUrl);
            
            // Start audio processing
            await this.audioService.startRecording(async (text, confidence, isFinal) => {
                if (!text || !isFinal) {
                    return;
                }
                
                try {
                    const response = await this.queryService.processQuery(text);
                    if (response) {
                        console.log('Bot response:', response);
                    }
                } catch (error) {
                    console.error('Error handling transcript:', error);
                }
            });
            console.log('Audio recording started');

            // Initialize and start the query watcher
            console.log('Initializing query watcher...');
            await this.watcherService.initialize();
            await this.watcherService.startWatching();
            
            console.log('MeetAgent started successfully');
        } catch (error) {
            console.error('Error starting MeetAgent:', error);
            await this.cleanup();
            throw error;
        }
    }

    async cleanup(preserveSession = true) {
        if (this.isShuttingDown) {
            console.log('Cleanup already in progress...');
            return;
        }

        this.isShuttingDown = true;
        console.log('Starting graceful shutdown...');

        try {
            // Stop audio recording
            console.log('Stopping audio recording...');
            if (this.audioService) {
                await this.audioService.stopRecording();
            }

            // Stop query watcher
            console.log('Stopping query watcher...');
            if (this.watcherService) {
                await this.watcherService.stopWatching();
            }

            // Clear query file
            console.log('Clearing query file...');
            if (this.watcherService) {
                await this.watcherService.clearQueryFile();
            }
            console.log('Query file cleared successfully');

            // Clean up browser
            console.log('Cleaning up browser...');
            if (this.browserService) {
                await this.browserService.cleanup(preserveSession);
            }
            console.log('Browser cleaned up successfully');

            console.log('Cleanup completed successfully');

        } catch (error) {
            console.error('Error during cleanup:', error);
        }
    }
}

// Handle process termination
process.on('SIGINT', async () => {
    console.log('Received SIGINT. Starting graceful shutdown...');
    const agent = global.meetAgent;
    if (agent) {
        await agent.cleanup();
        
        // Force exit after timeout
        setTimeout(() => {
            console.log('Shutdown timeout reached');
            console.log('Forcing exit...');
            process.exit(1);
        }, agent.shutdownTimeout);
    }
});

process.on('uncaughtException', async (error) => {
    console.log('Received uncaughtException. Starting graceful shutdown...');
    console.error('Uncaught exception:', error);
    
    const agent = global.meetAgent;
    if (agent) {
        await agent.cleanup();
        
        // Force exit after timeout
        setTimeout(() => {
            console.log('Shutdown timeout reached');
            console.log('Forcing exit...');
            process.exit(1);
        }, agent.shutdownTimeout);
    }
});

// Create and start the agent
const agent = new MeetAgent();
global.meetAgent = agent;
agent.start().catch(error => {
    console.error('Failed to start MeetAgent:', error);
    process.exit(1);
});
