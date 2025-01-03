# Meet Agent

A Node.js bot that can automatically join Google Meet sessions, process conversations using AI, and interact using text-to-speech capabilities.

## Features

- Automated Google Meet session joining
- Real-time audio transcription
- AI-powered conversation processing
- Text-to-speech response capability
- Integration with multiple AI services

## Prerequisites

- Node.js (v14 or higher)
- Google account credentials
- Windows OS with Stereo Mix enabled
  - Stereo Mix is required to capture system audio
  - Enable and configure in Windows Sound settings:
    1. Right-click the speaker icon in taskbar
    2. Select "Sound settings"
    3. Click "Sound Control Panel"
    4. In Recording tab:
       - Right-click and enable "Show Disabled Devices"
       - Right-click "Stereo Mix" and enable it
       - Set "Stereo Mix" as default device
    5. In Playback tab:
       - Set your speakers/headphones as default
    6. In Chrome/Browser settings:
       - Set audio input device to "Stereo Mix"
       - Set audio output to your speakers/headphones
    7. Test Stereo Mix:
       - Play some audio and check if Stereo Mix level meter moves
       - If not, increase system volume and app volumes

- API keys for:
  - OpenAI
  - Pinecone
  - ElevenLabs
  - Google Cloud (for Speech-to-Text and Text-to-Speech)

## Project Structure

```
meet-agent/
├── src/                    # Source code
│   ├── index.js           # Main entry point
│   └── services/          # Core services
│       ├── AudioService.js     # Audio recording and speech recognition
│       ├── BrowserService.js   # Browser automation
│       ├── QueryService.js     # Query processing
│       ├── TextToSpeechService.js # Text-to-speech handling
│       └── WatcherService.js   # File system monitoring
├── audio_output/          # Generated audio files
├── query/                 # Real-time transcript output
├── import/                # Integration files
└── logs/                  # Application logs
```

## Setup

1. Clone the repository:
```bash
git clone https://github.com/yourusername/meet-agent.git
cd meet-agent
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
   - Copy `.env.example` to `.env`
   - Fill in your credentials and API keys in `.env`

## Required API Keys

1. **Google Account**
   - Need a Google account for Meet access
   - Enable less secure app access or use App Passwords

2. **Pinecone**
   - Sign up at [Pinecone](https://www.pinecone.io/)
   - Create an index and get API key

3. **OpenAI**
   - Get API key from [OpenAI](https://platform.openai.com/)

4. **ElevenLabs**
   - Sign up at [ElevenLabs](https://elevenlabs.io/)
   - Get API key for text-to-speech

## Usage

To start the bot:
```bash
node src/index.js
```

The bot will:
1. Sign in to your Google account
2. Join the specified Meet session
3. Begin processing audio and responding as configured

## Development

- `npm run test` - Run tests
- Check logs in `logs/` directory for debugging
- Audio output stored in `audio_output/`
- Real-time transcripts in `query/`

## Security Notes

- Never commit `.env` file
- Keep API keys secure
- Regularly rotate credentials
- Monitor API usage

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

ISC License - See LICENSE file for details

## Critical System Configuration

1. **FFmpeg Configuration:**
   - FFmpeg must be installed via WinGet
   - Default path: `C:\Users\[USERNAME]\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-7.1-full_build\bin`
   - Update `AudioPlayer.js` with your system's FFmpeg path

2. **Audio Device Names:**
   - The following audio devices must be available and named exactly:
     ```
     'Microphone Array (Realtek(R) Audio)'
     'Microphone (Realtek(R) Audio)'
     'Stereo Mix (Realtek(R) Audio)'
     ```
   - Or update `audioDevices` array in `src/services/AudioService.js`

3. **Google Cloud Credentials:**
   - Place `meetBot-credentials.json` in `src/creds/` directory
   - File structure must match:
     ```
     src/
     └── creds/
         └── meetBot-credentials.json
     ```

4. **Directory Structure:**
   - Following directories must exist and be writable:
     ```
     audio_output/
     query/
     import/
     logs/
     src/creds/
     ```

5. **Chrome Configuration:**
   - Chrome must be installed in default location
   - No other Chrome instances should be running
   - Clear Chrome user data before first run
   - Location: `C:\Users\[USERNAME]\AppData\Local\Google\Chrome\User Data`

## First-Time Setup

1. Install FFmpeg using WinGet:
   ```powershell
   winget install Gyan.FFmpeg
   ```

2. Create required directories:
   ```bash
   mkdir audio_output query import logs "src/creds"
   ```

3. Configure audio devices:
   - Either rename your audio devices to match the expected names
   - Or update `audioDevices` array in `src/services/AudioService.js`

4. Update FFmpeg path:
   - Locate your FFmpeg installation path
   - Update `ffmpegPath` in `src/services/AudioPlayer.js`

5. Clear Chrome data:
   ```powershell
   Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Google\Chrome\User Data"
   ```
