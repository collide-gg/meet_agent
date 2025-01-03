require('dotenv').config();
const QueryService = require('./src/services/QueryService');

async function testQuestion() {
    try {
        // Initialize QueryService without TTS
        console.log('Initializing QueryService...');
        const queryService = new QueryService({ skipTTS: true });
        await queryService.initialize();

        // Get user input
        const readline = require('readline').createInterface({
            input: process.stdin,
            output: process.stdout
        });

        // Prompt for question
        const question = await new Promise(resolve => {
            readline.question('Enter your question: ', answer => {
                readline.close();
                resolve(answer);
            });
        });

        console.log('\nProcessing question:', question);

        // Process the query directly using the existing processQuery method
        console.log('\nGenerating analysis...');
        const analysis = await queryService.processQuery(question);

        // Display the analysis response
        console.log('\n=== Analysis Response ===');
        if (analysis) {
            console.log(analysis);
        } else {
            console.log('No analysis generated');
        }

        process.exit(0);

    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

// Run the test
testQuestion(); 