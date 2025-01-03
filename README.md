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
npm start
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
