import { TagAsync } from "./TagAsync.js";
import dcmjs from "dcmjs";
const { ValueRepresentation } = dcmjs.data;

async function readFrame(stream, frameIndex = 0) {
    let vrType = await stream.readVR();
    let vr = ValueRepresentation.createByTypeString(vrType);
    if (vr.isExplicit()) {
        await stream.increment(2);
        await stream.readUint32();
    } else {
        await stream.readUint16();
    }

    const itemTagValue = await TagAsync.readTag(stream);

    if (!itemTagValue.is(0xfffee000)) {
        throw new Error("Item tag not found after undefined binary length");
    }

    const itemLength = await stream.readUint32();
    let numberOfFrames = 1;
    let offsets = [];

    if (itemLength > 0) {
        numberOfFrames = itemLength / 4;
        if (frameIndex !== undefined && (frameIndex < 0 || frameIndex >= numberOfFrames)) {
            throw new Error(`Frame index ${frameIndex} out of range (0-${numberOfFrames - 1})`);
        }

        for (let i = 0; i < numberOfFrames; i++) {
            offsets.push(await stream.readUint32());
        }

    } 

    const SequenceItemTag = 0xfffee000;
    const SequenceDelimiterTag = 0xfffee0dd;
    
    const getNextSequenceItemData = async (stream) => {
        const nextTag = await TagAsync.readTag(stream);
        if (nextTag.is(SequenceItemTag)) {
            const itemLength = await stream.readUint32();
            const buffer = await stream.readNBytes(itemLength);
            return buffer;
        } else if (nextTag.is(SequenceDelimiterTag)) {
            if (await stream.readUint32() !== 0) {
                throw Error("SequenceDelimiterItem tag value was not zero");
            }
            return null;
        }
        throw Error("Invalid tag in sequence");
    };
    const readSingleFrame = async () => {
        return await getNextSequenceItemData(stream);
    };

    if (offsets.length > 0) {
        if (offsets.length === 1 && frameIndex === 0) {
            return await readSingleFrame();
        }

        if (offsets.length === 1 && frameIndex !== 0) {
            throw new Error(`Frame index ${frameIndex} out of range, only found 1 frames`);
        }

        for(let i = 1 ; i < offsets.length; i++) {
            if (i === frameIndex + 1) break;

            let frameLength = offsets[i] - offsets[i - 1];
            if(frameLength > 0) {
                await getNextSequenceItemData(stream);
            }
        }
    } else {
        
        let currentFrame = 0;
        while (currentFrame < frameIndex) {
            const buffer = await getNextSequenceItemData(stream);
            if (buffer === null) {
                throw new Error(`Frame index ${frameIndex} out of range, only found ${currentFrame} frames`);
            }
            currentFrame++;
        }
    }
    return await readSingleFrame();
}

export { readFrame };