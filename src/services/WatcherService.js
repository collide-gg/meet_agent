const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const QueryService = require('./QueryService');

class WatcherService {
    constructor() {
        this.queryService = new QueryService();
        this.queryDir = path.join(__dirname, '..', '..', 'query');
        this.queryFile = path.join(this.queryDir, 'query.txt');
        this.lastProcessedSize = 0;
        this.isProcessing = false;
        this.initialized = false;
        this.watcher = null;
    }

    async initialize() {
        try {
            await this.queryService.initialize();
            
            // Create query directory if it doesn't exist
            if (!fs.existsSync(this.queryDir)) {
                fs.mkdirSync(this.queryDir, { recursive: true });
            }

            // Create query file if it doesn't exist
            if (!fs.existsSync(this.queryFile)) {
                fs.writeFileSync(this.queryFile, '');
            }

            this.lastProcessedSize = fs.statSync(this.queryFile).size;
            this.initialized = true;
            console.log('WatcherService initialized successfully');
        } catch (error) {
            console.error('Error initializing WatcherService:', error);
            throw error;
        }
    }

    async startWatching() {
        if (!this.initialized) {
            await this.initialize();
        }

        // Initialize watcher
        this.watcher = chokidar.watch(this.queryFile, {
            persistent: true,
            awaitWriteFinish: {
                stabilityThreshold: 500,
                pollInterval: 100
            }
        });

        console.log(`Starting to watch ${this.queryFile} for changes...`);

        // Handle file changes
        this.watcher.on('change', async (path) => {
            if (this.isProcessing) {
                console.log('Still processing previous changes, skipping...');
                return;
            }

            try {
                this.isProcessing = true;
                await this.processNewContent();
            } catch (error) {
                console.error('Error processing file changes:', error);
            } finally {
                this.isProcessing = false;
            }
        });

        // Handle errors
        this.watcher.on('error', error => {
            console.error('Error watching file:', error);
        });

        // Process any existing content immediately
        try {
            if (fs.existsSync(this.queryFile)) {
                const stats = fs.statSync(this.queryFile);
                if (stats.size > 0) {
                    console.log('Processing existing content in query file...');
                    await this.processNewContent();
                }
            }
        } catch (error) {
            console.error('Error processing existing content:', error);
        }
    }

    async processNewContent() {
        console.log('\n=== Checking for New Content ===');
        try {
            const stats = fs.statSync(this.queryFile);
            const currentSize = stats.size;
            console.log('Current file size:', currentSize);
            console.log('Last processed size:', this.lastProcessedSize);

            // If file has shrunk, reset lastProcessedSize
            if (currentSize < this.lastProcessedSize) {
                console.log('File size has decreased, resetting lastProcessedSize');
                this.lastProcessedSize = 0;
            }

            // If no new content, skip processing
            if (currentSize <= this.lastProcessedSize) {
                console.log('No new content to process');
                return;
            }

            console.log(`Processing new content from position ${this.lastProcessedSize} to ${currentSize}`);

            // Read only the new content
            const buffer = Buffer.alloc(currentSize - this.lastProcessedSize);
            const fileHandle = await fs.promises.open(this.queryFile, 'r');
            await fileHandle.read(buffer, 0, buffer.length, this.lastProcessedSize);
            await fileHandle.close();

            const newContent = buffer.toString('utf8');
            console.log('New content:', newContent);
            
            // Process new content asynchronously
            await this.processContent(newContent);

            // Update the last processed size
            this.lastProcessedSize = currentSize;
            console.log('Updated last processed size to:', currentSize);
        } catch (error) {
            console.error('Error processing new content:', error);
            console.error('Error stack:', error.stack);
        }
    }

    async processContent(content) {
        console.log('\n=== Processing New Content ===');
        console.log('Content length:', content.length);
        
        const entries = content.split('\n\n').filter(entry => entry.trim());
        console.log('Number of entries found:', entries.length);
        
        // Process each entry in parallel
        const processingPromises = entries.map(async (entry, index) => {
            console.log(`\nProcessing entry ${index + 1}:`);
            console.log('Entry content:', entry);
            
            const lines = entry.split('\n');
            if (lines.length >= 2) { 
                const firstLine = lines[0];
                const text = lines.slice(1).join('\n').trim();

                // Extract timestamp and metadata from the first line
                const matches = firstLine.match(/\[(.*?)\] \[(FINAL|INTERIM)\] \(confidence: ([\d.]+)%\)/);
                
                if (matches) {
                    const [_, timestamp, finality, confidence] = matches;
                    console.log('Parsed entry:');
                    console.log('Timestamp:', timestamp);
                    console.log('Finality:', finality);
                    console.log('Confidence:', confidence);
                    console.log('Text:', text);

                    // Only process if it's a final transcript
                    if (finality === 'FINAL') {
                        console.log('\n=== Found [FINAL] transcript ===');
                        console.log('Final transcript text:', text);
                        try {
                            console.log('Initiating analysis generation...');
                            const result = await this.queryService.queryWithRecentTranscript();
                            console.log('Analysis result:', result);
                            if (result && result.analysis) {
                                console.log('Analysis generated successfully');
                                console.log('Analysis length:', result.analysis.length);
                            } else {
                                console.log('No analysis was generated');
                                console.log('Result object:', JSON.stringify(result, null, 2));
                            }
                        } catch (error) {
                            console.error('Error generating analysis:', error);
                            console.error('Error stack:', error.stack);
                        }
                    } else {
                        console.log('Skipping non-final transcript');
                    }
                } else {
                    console.log('Could not parse metadata from first line:', firstLine);
                }
            } else {
                console.log('Invalid entry format - not enough lines:', lines.length);
            }
        });

        try {
            console.log('\nWaiting for all entries to be processed...');
            await Promise.all(processingPromises);
            console.log('All entries processed successfully');
        } catch (error) {
            console.error('Error during parallel processing:', error);
            console.error('Error stack:', error.stack);
        }
    }

    async stopWatching() {
        try {
            if (this.watcher) {
                await this.watcher.close();
                console.log('Stopped watching query file');
            }
            
            // Clear queries when stopping
            await this.queryService.clearQueries();
        } catch (error) {
            console.error('Error stopping watcher:', error);
            throw error;
        }
    }
}

module.exports = WatcherService;
