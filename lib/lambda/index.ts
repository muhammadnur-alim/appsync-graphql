import { MongoClient, Db, Collection, WithId } from "mongodb";

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
let todos: Todo[] = [
  {
    id: "1",
    name: "Buy groceries",
    done: false,
    timestamp: "2024-11-25T10:00:00",
    deleted: false,
  },
  {
    id: "2",
    name: "Finish project report",
    done: true,
    timestamp: "2024-11-24T15:00:00",
    deleted: false,
  },
  {
    id: "3",
    name: "Walk the dog",
    done: false,
    timestamp: "2024-11-25T12:30:00",
    deleted: false,
  },
  {
    id: "4",
    name: "Clean the house",
    done: true,
    timestamp: "2024-11-23T08:00:00",
    deleted: true,
  },
];

let lastCheckpoint: Checkpoint = {
  id: "0",
  updatedAt: new Date().toISOString(),
};

const uri = `mongodb+srv://muhammadalim:BbxtygixchoWzcAL@cluster0.57kx0.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

let client: MongoClient;
let db: Db;

const connectToDatabase = async (dbName: string) => {
  try {
    if (!client) {
      client = new MongoClient(uri);
      console.log("Connecting to MongoDB...");
      await client.connect();
    }

    if (!db) {
      db = client.db(dbName); // Replace with your database name
      console.log(`Connected to database: ${dbName}`);
    }

    return db;
  } catch (error) {
    console.error("Failed to connect to MongoDB:", error);
    throw error;
  }
};

exports.handler = async (event: any) => {
  console.log("Received event:", JSON.stringify(event, null, 2));

  // GraphQL resolvers pass the operation name in info.fieldName
  const operation = event.info?.fieldName || event.operation;

  if (!operation) {
    throw new Error(`Missing operation - Event: ${JSON.stringify(event)}`);
  }

  // Handle operations
  switch (operation) {
    case "pullTodo":
      return handlePullTodo(event.arguments?.checkpoint || event.checkpoint);
    case "pushTodo":
      return handlePushTodo(event.arguments?.rows || event.rows);
    case "streamTodo":
      return handleStreamTodo(todos);
    default:
      throw new Error(`Unsupported operation: ${operation}`);
  }
};

async function handlePullTodo(checkpoint?: Checkpoint): Promise<TodoPullBulk> {
  const db = await connectToDatabase("db-graphql-test");
  const collection: Collection<Omit<Todo, "id">> = db.collection("todos");

  const todosMongoDb: WithId<Omit<Todo, "id">>[] = await collection
    .find({})
    .toArray();

  // Map MongoDB documents to the `Todo` type
  const todos: Todo[] = todosMongoDb.map((doc) => ({
    id: doc._id.toString(), // Convert ObjectId to string
    name: doc.name, // TypeScript now knows `name` exists
    done: doc.done,
    timestamp: doc.timestamp,
    deleted: doc.deleted,
  }));

  if (!checkpoint || checkpoint.updatedAt < lastCheckpoint.updatedAt) {
    return {
      documents: todos.filter((todo) => !todo.deleted),
      checkpoint: lastCheckpoint,
    };
  }

  // Return empty list if no changes since checkpoint
  return {
    documents: [],
    checkpoint: checkpoint,
  };
}

async function handlePushTodo(
  rows: TodoInputPushRow[]
): Promise<Todo[] | null> {
  const conflicts: Todo[] = [];

  for (const row of rows) {
    const { assumedMasterState, newDocumentState } = row;
    const existingTodo = todos.find((t) => t.id === newDocumentState.id);

    // Check for conflicts
    if (assumedMasterState && existingTodo) {
      if (JSON.stringify(existingTodo) !== JSON.stringify(assumedMasterState)) {
        conflicts.push(existingTodo);
        continue;
      }
    }

    // Update or insert the todo
    const newTodo: Todo = {
      id: newDocumentState.id,
      name: newDocumentState.name,
      done: newDocumentState.done,
      timestamp: newDocumentState.timestamp,
      deleted: newDocumentState.deleted || false,
    };

    const index = todos.findIndex((t) => t.id === newTodo.id);
    if (index >= 0) {
      todos[index] = newTodo;
    } else {
      todos.push(newTodo);
    }

    // Update checkpoint
    lastCheckpoint = {
      id: newTodo.id,
      updatedAt: new Date().toISOString(),
    };
  }

  return conflicts.length === 0 ? [] : conflicts;
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
