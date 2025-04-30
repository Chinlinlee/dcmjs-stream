import fs from "fs";
import path from "path";
import dcmjs from "dcmjs";
const { DicomMessage } = dcmjs.data;
import { DicomMessageAsync } from "../src/DicomMessageAsync.js";


const __dirname = import.meta.dirname;

(async () => {
    let filename = path.join(__dirname, "./data/0009.DCM");
    let dataset = await DicomMessageAsync.readFile(filename, {
        untilTag: null
    });

    console.log(dataset.dicomDict.dict["7FE00010"].Value.length);
})();