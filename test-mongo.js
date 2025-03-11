const { MongoClient } = require('mongodb');
require('dotenv').config();

async function testMongo() {
    const client = new MongoClient(process.env.MONGODB_URI, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 10000
    });

    try {
        console.log('Attempting to connect to MongoDB...');
        console.log('Using URI:', process.env.MONGODB_URI.replace(/(mongodb\+srv:\/\/[^:]+:)[^@]+(@.*)/, '$1****$2'));

        await client.connect();
        console.log('Connected successfully to MongoDB!');

        const db = client.db('instagram_bot');
        const result = await db.command({ ping: 1 });
        console.log('Database ping result:', result);

    } catch (err) {
        console.error('MongoDB Connection Error:', err);
    } finally {
        await client.close();
        console.log('Connection closed');
    }
}

testMongo(); 