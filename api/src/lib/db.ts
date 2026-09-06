import mongoose from "mongoose";

export async function connectDb(uri: string) {
  const connection = await mongoose.connect(uri);
  // Timeseries collections are created by a background createCollection() inside
  // Model.init(). A write that beats init() leaves the bucket collection without
  // its queryable view, and every later find() silently returns [].
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  return connection;
}

export async function disconnectDb() {
  await mongoose.disconnect();
}
