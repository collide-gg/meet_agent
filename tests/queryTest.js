const QueryService = require('../src/services/QueryService');
const ProcessResult = require('../src/services/ProcessResult');
const dotenv = require('dotenv');

dotenv.config();

async function testQuery() {
    try {
        // Initialize services
        console.log('1. Initializing services...');
        const queryService = new QueryService();
        await queryService.initialize();
        console.log('Services initialized successfully');

        // Test saving a query
        const sampleTranscript = "Cost reduction with cdpe";
        console.log('\n2. Testing query save with transcript:', sampleTranscript.substring(0, 50) + '...');
        
        // Save the query with [FINAL] tag
        await queryService.saveQuery(sampleTranscript, 0.95, true);
        console.log('Query saved successfully');

        // Get recent transcript
        console.log('\n3. Getting most recent transcript...');
        const recentTranscript = queryService.getMostRecentTranscript();
        console.log('Recent transcript found:', recentTranscript ? 'Yes' : 'No');

        // Perform the query
        console.log('\n4. Performing query with recent transcript...');
        const results = await queryService.queryWithRecentTranscript();
        
        // Log results
        console.log('\n5. Query Results:');
        if (!results) {
            console.log('No results returned from query');
        } else {
            console.log('\nContext:');
            console.log(results.context || 'No context available');
            
            console.log('\nSources:');
            if (results.sources && results.sources.length > 0) {
                results.sources.forEach((source, index) => {
                    console.log(`\nSource ${index + 1}:`);
                    console.log('ID:', source.id);
                    console.log('Score:', source.score);
                    console.log('Metadata:', JSON.stringify(source.metadata, null, 2));
                });
            } else {
                console.log('No sources available');
            }

            console.log('\nStats:');
            console.log('Total matches:', results.totalMatches);
            console.log('Relevant matches:', results.relevantMatches);
            
            if (results.analysis) {
                console.log('\nAnalysis:');
                console.log(results.analysis);
            }
        }

        // Test getting all analyses
        console.log('\n6. Getting saved analyses...');
        const analyses = queryService.getAnalyses();
        console.log(`Found ${analyses.length} saved analyses`);
        if (analyses.length > 0) {
            console.log('\nMost recent analysis:');
            console.log(JSON.stringify(analyses[0], null, 2));
        }

        // Clean up
        console.log('\n7. Cleaning up...');
        queryService.clearQueries();
        console.log('Queries cleared');

    } catch (error) {
        console.error('Error in test:', error);
        console.error('Stack trace:', error.stack);
    }
}

// Run the test
console.log('Starting RAG Flow test...\n');
testQuery();
