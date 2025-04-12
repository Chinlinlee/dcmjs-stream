# dcmjs-stream

Stream version for reading DICOM files of [dcmjs](https://github.com/dcmjs-org/dcmjs).

## Usage

```js
import { DicomMessageAsync } from "dcmjs-stream";
import { readFrame } from "dcmjs-stream/readFrame";

const dataset = await DicomMessageAsync.readFile("path/to/file.dcm", {
    untilTag: "7FE00010"
});

// Read the 136th frame
const frame = await readFrame(dataset.bufferStream, 136);
```

## Memory Benchmark

Below is the memory benchmark result of reading a 700MB DICOM file.

![Memory Benchmark Result](https://raw.githubusercontent.com/Chinlinlee/dcmjs-stream/main/memory-benchmark.png)
