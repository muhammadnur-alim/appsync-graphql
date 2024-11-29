import { MongoClient, Db, WithId, Collection } from "mongodb";

interface Todo {
  id: string;
  name: string;
  done: boolean;
  timestamp: string;
  deleted: boolean;
}

interface TodoInput {
  id: string;
  name: string;
  done: boolean;
  timestamp: string;
  deleted?: boolean;
}

interface Checkpoint {
  id: string;
  updatedAt: string;
}

interface TodoInputPushRow {
  assumedMasterState?: TodoInput;
  newDocumentState: TodoInput;
}

interface TodoPullBulk {
  documents: Todo[];
  checkpoint?: Checkpoint;
}

// In-memory storage for demonstration purposes
// Replace with actual database in production

let lastCheckpoint: Checkpoint = {
  id: "0",
  updatedAt: new Date().toISOString(),
};

const uri: string =
  "mongodb+srv://muhammadalim:BbxtygixchoWzcAL@cluster0.57kx0.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0"; // Replace with your MongoDB URI
const uri2: string =
  "mongodb+srv://dani:4YcgTMImCCPaVwzM@cluster0.olyde.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
const client: MongoClient = new MongoClient(process.env.MONGODB_URL!);

exports.handler = async (event: any) => {
  // Define the collection with a typed interface
  try {
    await client.connect();
    const db = client.db("db-graphql-test");
    const collection = db.collection("todos");

    // const db = client.db("db-graphql-test");
    // const collection = db.collection("todos");

    const operation = event.info?.fieldName || event.operationName;
    if (!operation) {
      throw new Error(`Missing operation - Event: ${JSON.stringify(event)}`);
    }

    switch (operation) {
      case "pullTodo":
        return await handlePullTodo(
          collection,
          event.arguments?.checkpoint || event.checkpoint
        );
      case "pushTodo":
        return await handlePushTodo(
          collection,
          event.arguments?.rows || event.rows
        );
      case "streamTodo":
        return handleStreamTodo([]);
      default:
        throw new Error(`Unsupported operation: ${operation}`);
    }
  } catch (error) {
    console.error(error);
    throw error;
  } finally {
    await client.close(); // Close the MongoDB connection
  }
};

async function handlePullTodo(
  collection: any,
  checkpoint: any
): Promise<{ documents: Todo[]; checkpoint: any }> {
  const limit = 100; // Fetch 100 documents at a time

  const todosMongoDb = await collection.find({}).limit(limit).toArray();

  const todos: Todo[] = todosMongoDb.map((doc: any) => ({
    id: doc._id.toString(),
    name: doc.name,
    done: doc.done,
    timestamp: doc.timestamp,
    deleted: doc.deleted,
  }));

  return {
    documents: todos.filter((todo) => !todo.deleted),
    checkpoint: lastCheckpoint || checkpoint,
  };
}

async function handlePushTodo(
  collection: any,
  rows: TodoInputPushRow[]
): Promise<Todo[] | null> {
  const conflicts: Todo[] = [];
  const limit = 100; // Fetch documents in chunks
  const todosMongoDb = await collection.find({}).limit(limit).toArray();

  // Transform MongoDB documents into Todo objects
  const todos: Todo[] = todosMongoDb.map((doc: any) => ({
    id: doc._id.toString(),
    name: doc.name,
    done: doc.done,
    timestamp: doc.timestamp,
    deleted: doc.deleted || false,
  }));

  for (const row of rows) {
    const { assumedMasterState, newDocumentState } = row;

    // Find an existing todo in the current list
    const existingTodo = todos.find((t) => t.id === newDocumentState.id);

    // Check for conflicts
    if (assumedMasterState && existingTodo) {
      if (JSON.stringify(existingTodo) !== JSON.stringify(assumedMasterState)) {
        // Conflict detected, skip this item
        conflicts.push(existingTodo);
        continue;
      }
    }

    // Create or update the todo
    const newTodo: Todo = {
      id: newDocumentState.id,
      name: newDocumentState.name,
      done: newDocumentState.done,
      timestamp: newDocumentState.timestamp,
      deleted: newDocumentState.deleted || false,
    };

    const index = todos.findIndex((t) => t.id === newTodo.id);

    if (index >= 0) {
      // Update existing todo
      todos[index] = newTodo;
      await collection.updateOne(
        { _id: newTodo.id },
        { $set: newTodo },
        { upsert: true }
      );
    } else {
      // Insert new todo
      todos.push(newTodo);
      await collection.insertOne(newTodo);
    }

    // Update checkpoint logic if necessary
    lastCheckpoint = {
      id: newTodo.id,
      updatedAt: new Date().toISOString(),
    };
  }

  // Return conflicts or an empty array if none were found
  return conflicts.length === 0 ? null : conflicts;
}

async function handleStreamTodo(todos: Todo[]): Promise<{
  documents: Todo[];
  checkpoint: { id: string; updatedAt: string };
}> {
  // Ensure there's at least one todo in the list to avoid issues with reduce
  if (todos.length === 0) {
    return {
      documents: [],
      checkpoint: { id: "", updatedAt: "" },
    };
  }

  // Map the todos to update their timestamp
  const newData = todos.map((todo: Todo) => ({
    ...todo,
    timestamp: new Date().toISOString(),
  }));

  // Find the latest todo based on the timestamp
  const latestTodo = todos.reduce((latest, current) =>
    new Date(current.timestamp) > new Date(latest.timestamp) ? current : latest
  );

  // Update the checkpoint with the latest todo's id and timestamp
  const lastCheckpoint = {
    id: latestTodo.id,
    updatedAt: latestTodo.timestamp,
  };

  return {
    documents: newData,
    checkpoint: lastCheckpoint,
  };
}
