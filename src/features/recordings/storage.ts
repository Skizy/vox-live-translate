import { type IDBPDatabase, openDB } from "idb";

const DATABASE_NAME = "VoxRecordingStorage";
const DATABASE_VERSION = 1;
const METADATA_STORE = "recording_meta";
const CONTENT_STORE = "recording_content";

export type RecordingMetadata = {
    id: string;
    timestamp: number;
    targetLanguageCode: string;
    title?: string;
};

type RecordingContent = {
    id: string;
    text: string;
};

let database: Promise<IDBPDatabase> | undefined;

function getDatabase() {
    if (typeof indexedDB === "undefined") {
        throw new Error("Recording storage is only available in the browser.");
    }

    database ??= openDB(DATABASE_NAME, DATABASE_VERSION, {
        upgrade(db) {
            const metadata = db.createObjectStore(METADATA_STORE, { keyPath: "id" });
            metadata.createIndex("by_timestamp", "timestamp");
            db.createObjectStore(CONTENT_STORE, { keyPath: "id" });
        },
    });

    return database;
}

export async function saveRecording(metadata: RecordingMetadata, text: string) {
    const db = await getDatabase();
    const transaction = db.transaction([METADATA_STORE, CONTENT_STORE], "readwrite");

    await transaction.objectStore(METADATA_STORE).put(metadata);
    await transaction.objectStore(CONTENT_STORE).put({ id: metadata.id, text } satisfies RecordingContent);
    await transaction.done;
}

export async function getRecordings() {
    const db = await getDatabase();
    const recordings = await db.getAllFromIndex(METADATA_STORE, "by_timestamp");
    return recordings.sort((first, second) => second.timestamp - first.timestamp) as RecordingMetadata[];
}

export async function getRecordingText(id: string) {
    const db = await getDatabase();
    return ((await db.get(CONTENT_STORE, id)) as RecordingContent | undefined)?.text;
}
