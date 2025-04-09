import { Client } from 'pg';
import { config } from 'dotenv';

config();

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Initialize connection
(async () => {
  try {
    await client.connect();
    console.log('Connected to database');
  } catch (err) {
    console.error('Database connection error:', err);
  }
})();

export const db = {
  query: (text: string, params?: any[]) => client.query(text, params),
  end: () => client.end(),
};
