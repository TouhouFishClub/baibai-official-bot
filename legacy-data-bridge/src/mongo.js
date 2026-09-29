const { MongoClient } = require('mongodb');

let clientPromise;

async function getDatabase(config) {
  if (!clientPromise) {
    const client = new MongoClient(config.mongoUri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000
    });
    clientPromise = client.connect().catch((error) => {
      clientPromise = null;
      throw error;
    });
  }
  const client = await clientPromise;
  return client.db(config.mongoDatabase);
}

async function closeMongo() {
  if (!clientPromise) return;
  const client = await clientPromise;
  clientPromise = null;
  await client.close();
}

module.exports = { getDatabase, closeMongo };
