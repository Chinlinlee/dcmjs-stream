import fs from "fs";
import path from "path";
import { test } from "node:test";
import assert from "node:assert";

import { DicomMessageAsync } from "../src/DicomMessageAsync.js";
import dcmjs from "dcmjs";
const { DicomMessage } = dcmjs.data;

const __dirname = import.meta.dirname;

test("frame number should be same as old dcmjs", async () => {
    let filename = path.join(__dirname, "../examples/data/0009.DCM");
    let dataset = await DicomMessageAsync.readFile(filename, {
        untilTag: null
    });

    let buffer = fs.readFileSync(filename);
    let dataset2 = DicomMessage.readFile(buffer.buffer, {
        untilTag: null
    });

    assert.equal(dataset.dict["7FE00010"].Value.length, dataset2.dict["7FE00010"].Value.length);
});

test("frames' length should be same as old dcmjs", async () => {
    let filename = path.join(__dirname, "../examples/data/0009.DCM");
    let dataset = await DicomMessageAsync.readFile(filename, {
        untilTag: null
    });

    let buffer = fs.readFileSync(filename);
    let dataset2 = DicomMessage.readFile(buffer.buffer, {
        untilTag: null
    });

    for (let i = 0; i < dataset.dict["7FE00010"].Value.length; i++) {
        assert.equal(dataset.dict["7FE00010"].Value[i].length, dataset2.dict["7FE00010"].Value[i].byteLength);
    }
});

test("frames' buffer should be same as old dcmjs", async () => {
    let filename = path.join(__dirname, "../examples/data/0009.DCM");
    let dataset = await DicomMessageAsync.readFile(filename, {
        untilTag: null
    });

    let buffer = fs.readFileSync(filename);
    let dataset2 = DicomMessage.readFile(buffer.buffer, {
        untilTag: null
    });

    for (let i = 0; i < dataset.dict["7FE00010"].Value.length; i++) {
        assert.equal(dataset.dict["7FE00010"].Value[i].length, Buffer.from(dataset2.dict["7FE00010"].Value[i]).length);
    }
});
