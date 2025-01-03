const { Builder, By, until, Key } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const dotenv = require('dotenv');
const AudioService = require('./AudioService');
const speech = require('@google-cloud/speech');
const record = require('node-record-lpcm16');
const fs = require('fs');
const path = require('path');

dotenv.config();

const BrowserService = {
  driver: null,
  audioService: null,
  speechClient: null,
  isListening: false,
  audioStream: null,
  transcriptionStartTime: null,

  initializeBrowser: async function() {
    if (this.driver) {
      return;
    }

    try {
      // Clear any existing Chrome profile first
      await this.clearSession();

      console.log('Initializing Chrome driver...');
      
      const options = new chrome.Options();
      
      // Add arguments to make Chrome more undetectable
      options.addArguments('--disable-blink-features=AutomationControlled');
      options.addArguments('--no-sandbox');
      options.addArguments('--disable-dev-shm-usage');
      options.addArguments('--disable-gpu');
      options.addArguments('--disable-notifications');
      options.addArguments('--window-size=1920,1080');
      options.addArguments('--start-maximized');
      options.addArguments('--disable-extensions');
      options.addArguments('--disable-popup-blocking');
      options.addArguments('--disable-infobars');
      
      // Set user agent
      options.addArguments('--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');
      
      // Add preferences
      options.addArguments(`--user-data-dir=${process.env.APPDATA}\\ChromeProfile`);
      options.addArguments('--profile-directory=Default');
      
      // Set preferences for media permissions
      const prefs = new Map([
        ['profile.default_content_setting_values.media_stream_mic', 1],
        ['profile.default_content_setting_values.media_stream_camera', 1],
        ['profile.default_content_setting_values.notifications', 2],
        ['profile.default_content_setting_values.geolocation', 2]
      ]);
      options.setUserPreferences(Object.fromEntries(prefs));
      
      this.driver = await new Builder()
        .forBrowser('chrome')
        .setChromeOptions(options)
        .build();

      // Execute CDP commands to make automation undetectable
      const cdpConnection = await this.driver.createCDPConnection('page');
      await cdpConnection.execute('Page.addScriptToEvaluateOnNewDocument', {
        source: `
          Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined
          });
          Object.defineProperty(navigator, 'languages', {
            get: () => ['en-US', 'en']
          });
          Object.defineProperty(navigator, 'plugins', {
            get: () => [1, 2, 3, 4, 5]
          });
        `
      });

      // Set script timeout to 30 seconds
      await this.driver.manage().setTimeouts({ script: 30000 });

      // Initialize speech client
      this.speechClient = new speech.SpeechClient();

    } catch (error) {
      console.error('Error initializing browser:', error);
      await this.cleanup();
      throw error;
    }
  },

  waitAndType: async function(selector, text, timeout = 10000) {
    const element = await this.driver.wait(
      until.elementLocated(By.css(selector)),
      timeout,
      `Timeout waiting for element: ${selector}`
    );
    
    await this.driver.wait(
      until.elementIsVisible(element),
      timeout,
      `Element not visible: ${selector}`
    );

    await this.driver.wait(
      until.elementIsEnabled(element),
      timeout,
      `Element not enabled: ${selector}`
    );

    // Clear any existing text
    await element.clear();
    
    // Type the text slowly to mimic human behavior
    for (const char of text) {
      await element.sendKeys(char);
      await this.driver.sleep(50 + Math.random() * 50);
    }
    
    return element;
  },

  isSignedIn: async function() {
    try {
      await this.driver.get('https://accounts.google.com/ServiceLogin');
      await this.driver.sleep(2000);

      const currentUrl = await this.driver.getCurrentUrl();
      if (!currentUrl.includes('signin')) {
        console.log('Already signed in to Google');
        return true;
      }

      try {
        await this.driver.findElement(By.css('a[aria-label*="Google Account"]'));
        console.log('Found Google Account element, user is signed in');
        return true;
      } catch (error) {
        console.log('Google Account element not found, user is not signed in');
        return false;
      }
    } catch (error) {
      console.error('Error checking sign-in status:', error);
      return false;
    }
  },

  signInToGoogle: async function() {
    if (!this.driver) {
      throw new Error('Browser not initialized');
    }

    try {
      if (await this.isSignedIn()) {
        console.log('Already signed in to Google, skipping sign-in process');
        return;
      }

      console.log('Navigating to Google sign-in page...');
      await this.driver.get('https://accounts.google.com/ServiceLogin');
      await this.driver.sleep(3000);

      // Wait for and enter email with slow typing
      console.log('Waiting for email input field...');
      await this.waitAndType('input[type="email"]', process.env.GOOGLE_EMAIL);
      
      // Click next button and wait
      console.log('Clicking next button...');
      const nextButton = await this.driver.wait(
        until.elementLocated(By.css('#identifierNext')),
        10000,
        'Next button not found'
      );
      await this.driver.wait(
        until.elementIsEnabled(nextButton),
        10000,
        'Next button not enabled'
      );
      await nextButton.click();
      
      // Wait longer for password field to be properly loaded
      await this.driver.sleep(5000);

      // Wait for and enter password with slow typing
      console.log('Waiting for password input field...');
      await this.waitAndType('input[type="password"]', process.env.GOOGLE_PASSWORD, 15000);
      
      // Click password next button and wait
      console.log('Clicking password next button...');
      const passwordNext = await this.driver.wait(
        until.elementLocated(By.css('#passwordNext')),
        10000,
        'Password next button not found'
      );
      await this.driver.wait(
        until.elementIsEnabled(passwordNext),
        10000,
        'Password next button not enabled'
      );
      await passwordNext.click();
      
      // Wait longer for sign-in to complete
      console.log('Waiting for sign-in to complete...');
      await this.driver.sleep(5000);
      await this.driver.wait(async () => {
        const url = await this.driver.getCurrentUrl();
        return !url.includes('signin') && !url.includes('challenge');
      }, 20000, 'Sign-in process did not complete');

      console.log('Successfully signed in to Google');

    } catch (error) {
      console.error('Error during Google sign-in:', error);
      throw error;
    }
  },

  turnOffDevices: async function() {
    console.log('Turning off camera and microphone...');
    
    try {
      // Wait for the buttons to be present
      await this.driver.sleep(2000);
      
      // Find and click camera button
      const cameraButton = await this.driver.wait(
        until.elementLocated(By.css('div[role="button"][data-is-muted][aria-label*="camera" i]')),
        5000
      );
      if (cameraButton) {
        await cameraButton.click();
        console.log('Clicked camera button');
      }
    } catch (error) {
      console.log('Error turning off devices:', error.message);
    }
  },

  async joinMeeting(meetUrl) {
    try {
      console.log('Joining meeting:', meetUrl);

      // Navigate to the meeting URL
      await this.driver.get(meetUrl);

      // Wait for and click the join button
      await this.driver.wait(
        until.elementLocated(By.css('button[jsname="Qx7uuf"]')),
        10000,
        'Join button not found'
      );

      const joinButton = await this.driver.findElement(By.css('button[jsname="Qx7uuf"]'));
      console.log('Meet page loaded, found element: button[jsname="Qx7uuf"]');

      // Turn off camera and microphone before joining
      console.log('Turning off camera and microphone...');
      await this.turnOffDevices();

      await this.driver.wait(
        until.elementIsVisible(joinButton),
        5000,
        'Join button not visible'
      );

      await this.driver.wait(
        until.elementIsEnabled(joinButton),
        5000,
        'Join button not enabled'
      );

      // Try multiple click methods
      try {
        // Method 1: JavaScript click
        await this.driver.executeScript('arguments[0].click();', joinButton);
      } catch (error) {
        console.log('JavaScript click failed, trying WebDriver click');
        try {
          // Method 2: WebDriver click
          await joinButton.click();
        } catch (error) {
          console.log('WebDriver click failed, trying Actions click');
          // Method 3: Actions click
          const actions = this.driver.actions({bridge: true});
          await actions.move({origin: joinButton}).click().perform();
        }
      }
      
      console.log('Clicked join button');
      
      // Wait to confirm we've joined
      await this.driver.sleep(2000);
      
      // Initialize audio service and start speech recognition
      console.log('Starting audio recording...');
      if (!this.audioService) {
        this.audioService = new AudioService();
      }
      await this.startSpeechRecognition();
    } catch (error) {
      console.error('Error joining meeting:', error);
      throw error;
    }
  },

  async startSpeechRecognition() {
    if (this.isListening) {
      console.log('Speech recognition is already running', 'WARN');
      return;
    }

    console.log('Starting speech recognition...', 'INFO');
    this.isListening = true;
    this.transcriptionStartTime = new Date();

    try {
      // Initialize Google Cloud Speech client if not already initialized
      if (!this.speechClient) {
        this.speechClient = new speech.SpeechClient();

      }

      // Create AudioService instance if not exists
      if (!this.audioService) {
        const AudioService = require('./AudioService');
        this.audioService = new AudioService();
      }

      // Define the transcript callback
      const handleTranscript = (transcriptData) => {
        if (!transcriptData) return;
        console.log('Received transcript data:', transcriptData);
        
        try {
          this.processTranscript(
            transcriptData.text,
            transcriptData.confidence,
            transcriptData.isFinal,
            transcriptData.timestamp
          );
        } catch (error) {
          console.error('Error processing transcript:', error);
        }
      };

      // Start recording with transcript callback
      await this.audioService.startRecording(handleTranscript);
      console.log('Speech recognition started successfully', 'INFO');
    } catch (error) {
      console.error('Failed to start speech recognition:', error);
      this.isListening = false;
      throw error;
    }
  },

  async stopSpeechRecognition() {
    if (!this.isListening) {
      console.log('Speech recognition is not running', 'WARN');
      return;
    }

    console.log('Stopping speech recognition...', 'INFO');
    try {
      if (this.audioService) {
        await this.audioService.stopRecording();
      }
      this.isListening = false;

      // Calculate and log session statistics
      if (this.transcriptionStartTime) {
        const duration = (new Date() - this.transcriptionStartTime) / 1000;
        console.log(`Speech recognition session ended. Duration: ${duration.toFixed(2)} seconds`, 'INFO');
        this.transcriptionStartTime = null;
      }

      console.log('Speech recognition stopped successfully', 'INFO');
    } catch (error) {
      console.error('Error stopping speech recognition:', error);
      throw error;
    }
  },

  processTranscript(transcript, confidence, isFinal, timestamp = new Date().toISOString()) {
    // Check if system is speaking
    if (this.queryService && this.queryService.isSpeaking) {
        console.log('System is speaking, ignoring transcript');
        return;
    }

    if (!transcript || transcript.trim().length === 0) {
      return;
    }

    const queryDir = path.join(__dirname, '..', '..', 'query');
    if (!fs.existsSync(queryDir)) {
      fs.mkdirSync(queryDir, { recursive: true });
    }

    // Format the transcript entry
    const confidenceStr = confidence ? ` (confidence: ${(confidence * 100).toFixed(2)}%)` : '';
    const finalityStr = isFinal ? '[FINAL]' : '[INTERIM]';
    const transcriptEntry = `[${timestamp}] ${finalityStr}${confidenceStr}\n${transcript}\n\n`;

    // Log transcript
    console.log(`Transcript: ${transcript}${confidenceStr}`, isFinal ? 'INFO' : 'DEBUG');

    // Only save final transcripts to file
    if (isFinal) {
      try {
        // Save to query file
        const queryFile = path.join(queryDir, 'query.txt');
        fs.appendFileSync(queryFile, transcriptEntry);
        console.log(`Updated query file: ${queryFile}`, 'INFO');
      } catch (error) {
        console.error('Error saving transcript:', error);
      }
    }
  },

  clearSession: async function(preserveSession = true) {
    try {
      console.log('Managing Chrome profile...');
      const profilePath = `${process.env.APPDATA}\\ChromeProfile`;
      
      if (fs.existsSync(profilePath)) {
        if (!preserveSession) {
          try {
            // Only remove profile if we're not preserving the session
            fs.rmSync(profilePath, { recursive: true, force: true });
            console.log('Chrome profile cleared successfully');
          } catch (error) {
            if (error.code === 'EBUSY') {
              console.log('Chrome profile is in use, skipping clear');
            } else {
              console.error('Error managing Chrome profile:', error);
            }
          }
        } else {
          console.log('Preserving Chrome profile for session restoration');
        }
      }
    } catch (error) {
      console.error('Error in clearSession:', error);
    }
  },

  cleanup: async function(preserveSession = true) {
    try {
      // Close browser if it's open
      if (this.driver) {
        try {
          await this.driver.quit();
        } catch (error) {
          console.error('Error closing browser:', error);
        }
        this.driver = null;
      }

      // Clear Chrome profile if not preserving session
      await this.clearSession(preserveSession);

      // Clear query.txt file
      const queryDir = path.join(__dirname, '..', '..', 'query');
      const queryFile = path.join(queryDir, 'query.txt');
      if (fs.existsSync(queryFile)) {
        fs.writeFileSync(queryFile, ''); // Clear the file
        console.log('Cleared query.txt file');
      }

      // Reset other properties
      this.speechClient = null;
      this.isListening = false;
      this.audioStream = null;
      this.transcriptionStartTime = null;

    } catch (error) {
      console.error('Error in cleanup:', error);
    }
  }
};

module.exports = BrowserService;
