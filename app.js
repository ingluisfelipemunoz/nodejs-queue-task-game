const express = require("express");
const Queue = require("bull");
const { Pool } = require("pg");

const app = express();
app.use(express.json());
const redisHost = process.env.REDIS_HOST || "localhost";
const redisPort = process.env.REDIS_PORT || 6379;

// queue
const playerQueue = new Queue("playerQueue", {
  redis: {
    host: redisHost,
    port: redisPort,
  },
});

playerQueue
  .isReady()
  .then(() => console.log("Connected to Redis"))
  .catch((err) => console.error("Redis connection error:", err));

// db connection
const pool = new Pool({
  user: process.env.POSTGRES_USER,
  host: process.env.POSTGRES_HOST,
  database: process.env.POSTGRES_DB,
  password: process.env.POSTGRES_PASSWORD,
  port: process.env.POSTGRES_PORT,
});

pool
  .connect()
  .then(() => console.log("Connected to PostgreSQL"))
  .catch((err) => console.error("PostgreSQL connection error:", err.stack));

// db functions //todo: add the functions and connection to otherss files
async function addPlayerToDB(player) {
  const query = "INSERT INTO players (name) VALUES ($1) RETURNING id";
  const values = [player.name];
  const res = await pool.query(query, values);
  return res.rows[0].id;
}

async function getPlayerFromDB(playerId) {
  const query = "SELECT * FROM players WHERE id = $1";
  const values = [playerId];
  const res = await pool.query(query, values);
  return res.rows[0];
}

async function addActionToDB(playerId, action) {
  const query = "INSERT INTO actions (player_id, action) VALUES ($1, $2)";
  const values = [playerId, action];
  await pool.query(query, values);
}

// add players
async function addPlayer(player) {
  const playerId = await addPlayerToDB(player);
  console.log("data inserted", playerId);
  console.log("adding job");
  try {
    const job = await playerQueue.add({ ...player, id: playerId });
    console.log("Player added to queue with job ID:", job.id);
    return job.id;
  } catch (error) {
    console.error("Error adding player to queue:", error);
  }
}

// process player turns
async function processTurns() {
  while (true) {
    const job = await playerQueue.getNextJob();
    if (job) {
      const player = job.data;
      console.log(`Processing turn for player: ${player.name}`);
      await performPlayerAction(player);
      await job.moveToCompleted();
      playerQueue.add(player);
    }
  }
}

// action
async function performPlayerAction(player) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  console.log(`${player.name} completed their turn.`);
}

// API endpoints //todo: agregar endpoints a otro archivo
app.post("/addPlayer", async (req, res) => {
  const player = req.body;
  console.log("adding player", player);
  const jobId = await addPlayer(player);
  res.send({ message: `Player ${player.name} added to the queue.`, jobId });
});
/** Curl
 curl -X POST http://localhost:3000/performAction \
-H "Content-Type: application/json" \
-d '{"playerName": "felipe", "action": "jump"}'
 */
app.post("/performAction", async (req, res) => {
  const { playerName, action } = req.body;
  const jobs = await playerQueue.getJobs(["waiting", "active"]);
  const job = jobs.find((job) => job.data.name === playerName);

  if (job) {
    job.data.action = action;
    await addActionToDB(job.data.id, action);
    res.send({
      message: `Action ${action} added for player ${playerName}.`,
      jobId: job.id,
    });
  } else {
    res.status(404).send(`Player ${playerName} not found in the queue.`);
  }
});
/** CURL
curl http://localhost:3000/jobStatus/12345
 */
app.get("/jobStatus/:jobId", async (req, res) => {
  const { jobId } = req.params;
  const job = await playerQueue.getJob(jobId);

  if (job) {
    const state = await job.getState();
    res.send({ jobId, state, progress: job.progress(), player: job.data });
  } else {
    res.status(404).send(`Job with ID ${jobId} not found.`);
  }
});
//iniciamos
processTurns();

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
