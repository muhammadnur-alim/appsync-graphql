import {
  MongoClient,
  ObjectId,
  ChangeStream,
  ChangeStreamDocument,
  ChangeStreamInsertDocument,
  ChangeStreamUpdateDocument,
} from "mongodb";
import { todo } from "node:test";

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

interface PushResponse {
  conflicts: Todo[];
  conflictMessage: string;
  changes: Todo[];
  changeAction: string[];
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
    const db = client.db(process.env.DB_NAME);
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

// Helper function to transform a MongoDB document into a Todo object
function transformDocumentToTodo(doc: any): Todo {
  return {
    id: doc._id.toString(),
    name: doc.name,
    done: doc.done,
    timestamp: doc.timestamp,
    deleted: doc.deleted || false,
  };
}

async function handlePullTodo(
  collection: any,
  checkpoint: any
): Promise<{ documents: Todo[]; checkpoint: any }> {
  const limit = 100; // Fetch 100 documents at a time

  const todosMongoDb = await collection.find({}).limit(limit).toArray();

  const todos: Todo[] = todosMongoDb.map(transformDocumentToTodo);

  return {
    documents: todos.filter((todo) => !todo.deleted),
    checkpoint: lastCheckpoint || checkpoint,
  };
}

async function handlePushTodo(
  collection: any,
  rows: TodoInputPushRow[]
): Promise<PushResponse | null> {
  const conflicts: Todo[] = [];
  const changedTodos: Todo[] = [];
  const changeActions: string[] = [];
  const limit = 100; // Fetch documents in chunks
  const todosMongoDb = await collection.find({}).limit(limit).toArray();

  // Transform MongoDB documents into Todo objects
  const todos: Todo[] = todosMongoDb.map(transformDocumentToTodo);

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
      // Compare the relevant fields to detect actual updates
      const existing = todos[index];

      const hasChanges =
        existing.name !== newTodo.name ||
        existing.done !== newTodo.done ||
        existing.timestamp !== newTodo.timestamp ||
        existing.deleted !== newTodo.deleted;

      if (hasChanges) {
        // Update existing todo if there are changes
        todos[index] = newTodo;
        await collection.updateOne(
          { _id: new ObjectId(newTodo.id) }, // Convert to ObjectId
          {
            $set: {
              name: newTodo.name,
              done: newTodo.done,
              timestamp: newTodo.timestamp,
              deleted: newTodo.deleted,
            },
          },
          { upsert: true }
        );

        // Record the updated todo and action
        changedTodos.push(newTodo);
        changeActions.push(newTodo.deleted ? "delete" : "updated");
      }
    } else {
      // Insert new todo if not found
      todos.push(newTodo);
      await collection.insertOne(newTodo);

      // Record the new todo and action
      changedTodos.push(newTodo);
      changeActions.push("inserted");
    }

    // Update checkpoint logic if necessary
    lastCheckpoint = {
      id: newTodo.id,
      updatedAt: new Date().toISOString(),
    };
  }

  // Return conflicts or an empty array if none were found
  // Return PushResponse structure
  const conflictMessage =
    conflicts.length > 0 ? "Conflicts detected" : "No conflicts";
  return {
    conflicts: conflicts.length > 0 ? conflicts : [],
    conflictMessage,
    changes: changedTodos,
    changeAction: changeActions, // Return actions array
  };
}
