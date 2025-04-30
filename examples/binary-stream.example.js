import { DicomMessageAsync } from "../src/DicomMessageAsync.js";
import path from "path";

const __dirname = import.meta.dirname;

(async () => {
    let filename = path.join(__dirname, "./data/0009.DCM");
    let dataset = await DicomMessageAsync.readFile(filename, {
        untilTag: null,
        binaryAsStream: true
    });

    let stream = dataset.dicomDict.dict["7FE00010"].Value[0];

    let chunkLength = 0;
    stream.on("data", (chunk) => {
        chunkLength += chunk.length;
    });

    stream.on("end", () => {
        console.log(chunkLength);
    });
})();