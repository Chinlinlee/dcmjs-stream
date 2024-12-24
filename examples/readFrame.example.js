import fs from "fs";
import path from "path";
import dcmjs from "dcmjs";
const { DicomMessage } = dcmjs.data;
import { DicomMessageAsync } from "../src/DicomMessageAsync.js";
import { readFrame } from "../src/readFrame.js";

const __dirname = import.meta.dirname;

(async () => {
    let filename = path.join(__dirname, "./data/0009.DCM");
    let dataset = await DicomMessageAsync.readFile(filename, {
        untilTag: "7FE00010"
    });

    let frame = await readFrame(dataset.bufferStream, 136);
    console.log(frame);
    console.log(frame.length);

    dataset.bufferStream.close();
})();