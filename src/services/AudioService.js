const speech = require('@google-cloud/speech');
const path = require('path');
const { spawn } = require('child_process');
const ffmpeg = require('@ffmpeg-installer/ffmpeg');

class AudioService {
    constructor() {
        this.isRecording = false;
        this.ffmpegProcess = null;
        this.speechClient = null;
        this.recognizeStream = null;
        this.isPlayingTTS = false;
        this.isPlayingAudio = false;
        this.wasRecordingBeforeAudio = false;
        this.audioDevices = [
            'Microphone Array (Realtek(R) Audio)',
            'Microphone (Realtek(R) Audio)',
            'Stereo Mix (Realtek(R) Audio)',
            'default'
        ];
        this.lastTTSEndTime = 0;
        this.feedbackPreventionDelay = 1000; // 1 second delay after TTS ends
        this.recentResponses = new Set(); // Store recent bot responses
        this.responseTimeout = 30000; // Clear responses after 30 seconds
    }

    setTTSState(isPlaying) {
        this.isPlayingTTS = isPlaying;
        if (!isPlaying) {
            this.lastTTSEndTime = Date.now();
        }
    }

    storeResponse(text) {
        // Clean and store the response
        const cleanResponse = this.cleanText(text);
        this.recentResponses.add(cleanResponse);
        
        // Set timeout to remove the response
        setTimeout(() => {
            this.recentResponses.delete(cleanResponse);
        }, this.responseTimeout);
    }

    cleanText(text) {
        if (!text || typeof text !== 'string') {
            return '';
        }
        return text.toLowerCase()
            .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '') // Remove punctuation
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();
    }

    isSimilarToRecentResponses(text) {
        if (!text || typeof text !== 'string') {
            return false;
        }
        
        const cleanInput = this.cleanText(text);
        if (!cleanInput) {
            return false;
        }
        
        for (const response of this.recentResponses) {
            // Check for exact matches
            if (response === cleanInput) {
                return true;
            }
            
            // Check if input contains significant portion of any response
            if (response.length > 10) { // Only check substantial responses
                const words = response.split(' ');
                const consecutiveWordsToMatch = Math.min(3, Math.floor(words.length / 2));
                
                for (let i = 0; i <= words.length - consecutiveWordsToMatch; i++) {
                    const phrase = words.slice(i, i + consecutiveWordsToMatch).join(' ');
                    if (phrase.length > 10 && cleanInput.includes(phrase)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    shouldProcessAudio(transcript) {
        // Don't process audio if TTS is playing
        if (this.isPlayingTTS) {
            console.log('Skipping processing - TTS is playing');
            return false;
        }
        
        // Don't process audio if we're within the feedback prevention delay
        const timeSinceLastTTS = Date.now() - this.lastTTSEndTime;
        if (timeSinceLastTTS < this.feedbackPreventionDelay) {
            console.log('Skipping processing - within feedback prevention delay');
            return false;
        }
        
        // Check if the transcript is similar to recent responses
        if (transcript) {
            const text = typeof transcript === 'string' ? transcript : 
                        (transcript.text || transcript.alternatives?.[0]?.transcript || '');
            
            if (this.isSimilarToRecentResponses(text)) {
                console.log('Skipping processing - detected similar recent response');
                return false;
            }
        }
        
        return true;
    }

    async listAudioDevices() {
        return new Promise((resolve, reject) => {
            const ffmpeg = spawn(require('@ffmpeg-installer/ffmpeg').path, [
                '-list_devices', 'true',
                '-f', 'dshow',
                '-i', 'dummy'
            ]);

            let devices = '';
            ffmpeg.stderr.on('data', (data) => {
                devices += data.toString();
                console.log('Available devices:', data.toString());
            });

            ffmpeg.on('close', (code) => {
                resolve(devices);
            });

            ffmpeg.on('error', (err) => {
                reject(err);
            });
        });
    }

    async startRecording(transcriptCallback) {
        if (this.isRecording || this.isPlayingAudio) {
            console.log('Cannot start recording: ' + 
                (this.isRecording ? 'Recording already in progress' : 'Audio is playing'), 
                'WARN');
            return;
        }

        if (typeof transcriptCallback !== 'function') {
            throw new Error('transcriptCallback must be a function');
        }

        try {
            // List available devices first
            const deviceList = await this.listAudioDevices();
            console.log('Available audio devices:', deviceList);

            // Initialize speech client if not already initialized
            if (!this.speechClient) {
                this.speechClient = new speech.SpeechClient({
                    keyFilename: path.join(__dirname, '..', 'creds', 'meetBot-credentials.json')
                });
            }

            const encoding = 'LINEAR16';
            const sampleRateHertz = 16000;
            const languageCode = 'en-US';

            const request = {
                config: {
                    encoding: encoding,
                    sampleRateHertz: sampleRateHertz,
                    languageCode: languageCode,
                    enableAutomaticPunctuation: true,
                    model: 'latest_long',
                },
                interimResults: true,
            };

            // Create a recognize stream
            this.recognizeStream = this.speechClient
                .streamingRecognize(request)
                .on('error', console.error)
                .on('data', data => {
                    const result = data.results[0];
                    const transcript = result.alternatives[0].transcript;
                    
                    // Skip processing if we shouldn't process this audio
                    if (!this.shouldProcessAudio(transcript)) {
                        return;
                    }
                    
                    const isFinal = result.isFinal;
                    const confidence = isFinal ? result.alternatives[0].confidence * 100 : 0;
                    
                    if (transcriptCallback) {
                        transcriptCallback(transcript, confidence, isFinal);
                    }
                });

            // Try each audio device until one works
            let success = false;
            for (const device of this.audioDevices) {
                try {
                    console.log(`Attempting to use audio device: ${device}`);
                    
                    // Start FFmpeg process with current device
                    this.ffmpegProcess = spawn(require('@ffmpeg-installer/ffmpeg').path, [
                        '-f', 'dshow',
                        '-rtbufsize', '1024M',  // Increase real-time buffer size
                        '-thread_queue_size', '4096',  // Increase thread queue size
                        '-i', `audio=${device}`,
                        '-acodec', 'pcm_s16le',
                        '-ac', '1',
                        '-ar', '16000',
                        '-f', 's16le',
                        '-probesize', '32M',  // Increase probe size
                        '-analyzeduration', '0',  // Reduce analysis time
                        '-fflags', 'nobuffer',  // Reduce buffering
                        '-'
                    ]);

                    // Set up error handling
                    let deviceError = false;
                    this.ffmpegProcess.stderr.on('data', data => {
                        const message = data.toString();
                        console.log(`FFmpeg stderr: ${message}`, 'DEBUG');
                        if (message.includes('I/O error') || message.includes('Could not find')) {
                            deviceError = true;
                        }
                    });

                    // Wait a moment to check if the device works
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                    if (!deviceError) {
                        success = true;
                        console.log(`Successfully connected to audio device: ${device}`);
                        break;
                    } else {
                        this.ffmpegProcess.kill();
                        this.ffmpegProcess = null;
                    }
                } catch (error) {
                    console.error(`Error with device ${device}:`, error);
                    if (this.ffmpegProcess) {
                        this.ffmpegProcess.kill();
                        this.ffmpegProcess = null;
                    }
                }
            }

            if (!success) {
                throw new Error('Could not find a working audio device');
            }

            // Set up FFmpeg error handling
            this.ffmpegProcess.on('error', error => {
                console.error('FFmpeg process error:', error);
                this.stopRecording().catch(err => {
                    console.error('Error stopping recording after FFmpeg error:', err);
                });
            });

            // Pipe FFmpeg output to recognition stream
            this.ffmpegProcess.stdout.pipe(this.recognizeStream);
            this.isRecording = true;
            console.log('Started recording and speech recognition', 'INFO');

        } catch (error) {
            console.error('Failed to start recording:', error);
            await this.stopRecording();
            throw error;
        }
    }

    async stopRecording() {
        if (!this.isRecording) {
            console.log('No recording in progress', 'WARN');
            return;
        }

        try {
            this.isRecording = false;

            // Stop FFmpeg process
            if (this.ffmpegProcess) {
                this.ffmpegProcess.stdout.unpipe();
                this.ffmpegProcess.kill();
                this.ffmpegProcess = null;
            }

            // Close recognition stream
            if (this.recognizeStream) {
                this.recognizeStream.end();
                this.recognizeStream = null;
            }

            console.log('Stopped recording and speech recognition', 'INFO');
        } catch (error) {
            console.error('Error stopping recording:', error);
            throw error;
        }
    }

    async suspendListening() {
        this.wasRecordingBeforeAudio = this.isRecording;
        if (this.isRecording) {
            await this.stopRecording();
        }
        this.isPlayingAudio = true;
    }

    async resumeListening(transcriptCallback) {
        this.isPlayingAudio = false;
        if (this.wasRecordingBeforeAudio) {
            await this.startRecording(transcriptCallback);
            this.wasRecordingBeforeAudio = false;
        }
    }
}

module.exports = AudioService;
