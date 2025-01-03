const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');

/**
 * AudioPlayer class for handling audio playback through FFplay
 * @extends EventEmitter
 */
class AudioPlayer extends EventEmitter {
    /**
     * Create an AudioPlayer instance
     * @param {Object} config - Configuration object
     * @param {string} [config.ffmpegPath] - Custom path to FFmpeg installation
     * @param {string} [config.audioOutputDir] - Custom path to audio output directory
     * @param {number} [config.volume=100] - Default volume (0-100)
     */
    constructor(config = {}) {
        super();
        
        // Default FFmpeg path (based on winget installation)
        this.ffmpegPath = config.ffmpegPath || 'C:\\Users\\c0llide\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-7.1-full_build\\bin';
        this.ffplayPath = path.join(this.ffmpegPath, 'ffplay.exe');
        
        // Default audio output directory
        this.audioOutputDir = config.audioOutputDir || path.join(__dirname, '..', 'audio_output');
        
        // Default volume
        this.volume = Math.min(Math.max(config.volume || 100, 0), 100);
        
        // Current playback process
        this.currentProcess = null;
        
        // Validate FFplay installation
        this.validateFFplay();
    }

    /**
     * Validate FFplay installation
     * @private
     * @throws {Error} If FFplay is not found
     */
    validateFFplay() {
        if (!fs.existsSync(this.ffplayPath)) {
            throw new Error(`FFplay not found at: ${this.ffplayPath}. Please make sure FFmpeg is installed correctly.`);
        }
    }

    /**
     * Set playback volume
     * @param {number} volume - Volume level (0-100)
     */
    setVolume(volume) {
        this.volume = Math.min(Math.max(volume, 0), 100);
    }

    /**
     * Get the full path to an audio file
     * @private
     * @param {string} audioPath - Full path to audio file
     * @returns {string} Validated audio file path
     * @throws {Error} If file doesn't exist
     */
    getAudioPath(audioPath) {
        // Check if the path is already absolute
        const fullPath = path.isAbsolute(audioPath) ? audioPath : path.join(this.audioOutputDir, audioPath);
        
        if (!fs.existsSync(fullPath)) {
            throw new Error(`Audio file not found: ${fullPath}`);
        }
        return fullPath;
    }

    /**
     * Play an audio file
     * @param {string} audioPath - Full path to audio file
     * @param {Object} [options] - Playback options
     * @param {number} [options.volume] - Override default volume for this playback
     * @returns {Promise} Resolves when playback completes, rejects on error
     */
    async playAudio(audioPath, options = {}) {
        try {
            // Stop any current playback
            await this.stopAudio();

            const validatedPath = this.getAudioPath(audioPath);
            const volume = options.volume || this.volume;

            // Construct FFplay command
            const command = `"${this.ffplayPath}" -nodisp -autoexit -volume ${volume} "${validatedPath}"`;

            return new Promise((resolve, reject) => {
                this.currentProcess = exec(command, (error, stdout, stderr) => {
                    this.currentProcess = null;
                    
                    if (error && !stderr.includes('size=') && !stderr.includes('time=')) {
                        this.emit('error', error);
                        reject(error);
                        return;
                    }

                    // FFplay logs to stderr by default, but these are progress updates
                    if (stderr && stderr.includes('size=')) {
                        console.log(' DEBUG stderr:', stderr.split('\n').pop());
                    }

                    resolve();
                });
            });
        } catch (error) {
            console.error('Error playing audio:', error);
            throw error;
        }
    }

    /**
     * Stop current playback
     * @returns {Promise} Resolves when playback is stopped
     */
    async stopAudio() {
        if (this.currentProcess) {
            this.currentProcess.kill();
            this.currentProcess = null;
        }
        return Promise.resolve();
    }

    /**
     * Check if audio is currently playing
     * @returns {boolean} True if audio is playing
     */
    isPlaying() {
        return this.currentProcess !== null;
    }
}

module.exports = AudioPlayer;
