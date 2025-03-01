import fs from "fs";
import path from "path";
import dcmjs from "dcmjs";
const { DicomMessage } = dcmjs.data;
import { DicomMessageAsync } from "../src/DicomMessageAsync.js";
import { readFrame } from "../src/readFrame.js";
import v8 from "v8";

const __dirname = import.meta.dirname;

const formatMemoryUsage = (data) => `${Math.round(data / 1024 / 1024 * 100) / 100} MB`;

function getMemoryUsage() {
    const stats = v8.getHeapStatistics();
    return stats.used_heap_size;
}

async function measureMemory(func) {
    const before = process.memoryUsage();
    await func();
    const after = process.memoryUsage();
    
    console.log("before", {
        rss: formatMemoryUsage(before.rss),
        heapUsed: formatMemoryUsage(before.heapUsed),
        heapTotal: formatMemoryUsage(before.heapTotal),
        external: formatMemoryUsage(before.external)
    });
    console.log("after", {
        rss: formatMemoryUsage(after.rss),
        heapUsed: formatMemoryUsage(after.heapUsed),
        heapTotal: formatMemoryUsage(after.heapTotal),
        external: formatMemoryUsage(after.external)
    });
}

async function useStreamToReadFile() {
    let filename = path.join(__dirname, "./data/2.25.205297998729372793967793595026631297556.dcm");
    let dataset = await DicomMessageAsync.readFile(filename, {
        untilTag: "7FE00010"
    });
}

async function useDicomMessageToReadFile() {
    let filename = path.join(__dirname, "./data/2.25.205297998729372793967793595026631297556.dcm");
    let fileBuffer = await fs.promises.readFile(filename);
    let dataset = DicomMessage.readFile(fileBuffer.buffer, {
        untilTag: "7FE00010"
    });
}

console.log("Function A memory usage:");
await measureMemory(useStreamToReadFile);
console.log("Function B memory usage:");
await measureMemory(useDicomMessageToReadFile);