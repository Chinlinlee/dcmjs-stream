import dcmjs from "dcmjs";
const { ReadBufferStream, DicomMessage, DicomDict } = dcmjs.data;
import { StreamValueRepresentation } from "./StreamValueRepresentation.js";
import {  
    IMPLICIT_LITTLE_ENDIAN,
    EXPLICIT_LITTLE_ENDIAN,
    DEFLATED_EXPLICIT_LITTLE_ENDIAN,
    VM_DELIMITER
} from "../constants/dicom.js";
import { TagAsync } from "./TagAsync.js";
import { DicomReadableBufferStream } from "./DicomReadableBufferStream.js";

const singleVRs = ["SQ", "OF", "OW", "OB", "UN", "LT"];
const encodingMapping = {
    "": "iso-8859-1",
    "iso-ir-6": "iso-8859-1",
    "iso-ir-13": "shift-jis",
    "iso-ir-100": "latin1",
    "iso-ir-101": "iso-8859-2",
    "iso-ir-109": "iso-8859-3",
    "iso-ir-110": "iso-8859-4",
    "iso-ir-126": "iso-ir-126",
    "iso-ir-127": "iso-ir-127",
    "iso-ir-138": "iso-ir-138",
    "iso-ir-144": "iso-ir-144",
    "iso-ir-148": "iso-ir-148",
    "iso-ir-166": "tis-620",
    "iso-2022-ir-6": "iso-8859-1",
    "iso-2022-ir-13": "shift-jis",
    "iso-2022-ir-87": "iso-2022-jp",
    "iso-2022-ir-100": "latin1",
    "iso-2022-ir-101": "iso-8859-2",
    "iso-2022-ir-109": "iso-8859-3",
    "iso-2022-ir-110": "iso-8859-4",
    "iso-2022-ir-126": "iso-ir-126",
    "iso-2022-ir-127": "iso-ir-127",
    "iso-2022-ir-138": "iso-ir-138",
    "iso-2022-ir-144": "iso-ir-144",
    "iso-2022-ir-148": "iso-ir-148",
    "iso-2022-ir-149": "euc-kr",
    "iso-2022-ir-159": "iso-2022-jp",
    "iso-2022-ir-166": "tis-620",
    "iso-2022-ir-58": "iso-ir-58",
    "iso-ir-192": "utf-8",
    gb18030: "gb18030",
    "iso-2022-gbk": "gbk",
    "iso-2022-58": "gb2312",
    gbk: "gbk"
};

class DicomMessageAsync {
    static async _readTag(stream, syntax, options = {
        untilTag: null,
        includeUntilTagValue: false
    }) {
        const { untilTag, includeUntilTagValue } = options;
        let implicit = syntax == IMPLICIT_LITTLE_ENDIAN ? true : false,
            isLittleEndian =
                syntax == IMPLICIT_LITTLE_ENDIAN ||
                    syntax == EXPLICIT_LITTLE_ENDIAN
                    ? true
                    : false;

        let oldEndian = stream.isLittleEndian;

        stream.setEndian(isLittleEndian);
        let tag = await TagAsync.readTag(stream);

        if (untilTag === tag.toCleanString() && untilTag !== null) {
            if (!includeUntilTagValue) {
                return { tag: tag, vr: 0, values: 0 };
            }
        }

        let length = null,
            /** @type {StreamValueRepresentation | null} */
            vr = null,
            vrType;

        if (implicit) {
            length = await stream.readUint32();
            let elementData = DicomMessage.lookupTag(tag);
            if (elementData) {
                vrType = elementData.vr;
            } else {
                //unknown tag
                if (length == 0xffffffff) {
                    vrType = "SQ";
                } else if (tag.isPixelDataTag()) {
                    vrType = "OW";
                } else if (vrType == "xs") {
                    vrType = "US";
                } else if (tag.isPrivateCreator()) {
                    vrType = "LO";
                } else {
                    vrType = "UN";
                }
            }
            vr = StreamValueRepresentation.createByTypeString(vrType);
        } else {
            vrType = await stream.readVR();

            if (
                vrType === "UN" &&
                DicomMessage.lookupTag(tag) &&
                DicomMessage.lookupTag(tag).vr
            ) {
                vrType = DicomMessage.lookupTag(tag).vr;

                vr = StreamValueRepresentation.parseUnknownVr(vrType);
            } else {
                vr = StreamValueRepresentation.createByTypeString(vrType);
            }

            try {
                if (vr.isExplicit()) {
                    await stream.increment(2);
                    length = await stream.readUint32();
                } else {
                    length = await stream.readUint16();
                }
            } catch(e) {
                if (e.message.indexOf("Stream ended before") > -1) {
                    console.log("Stream maybe ended before readTag, but most can be loaded normally");
                } else {
                    console.error("error", e);
                }
            }
        }

        let values = [];
        let rawValues = [];

        if (vr.isBinary() && length > vr.maxLength && !vr.noMultiple) {
            let times = length / vr.maxLength,
                i = 0;
            while (i++ < times) {
                const { rawValue, value } = await vr.read(
                    stream,
                    vr.maxLength,
                    syntax,
                    options
                );
                rawValues.push(rawValue);
                values.push(value);
            }
        } else {
            const { rawValue, value } = await vr.read(
                stream,
                length,
                syntax,
                options
            );

            if (!vr.isBinary() && singleVRs.indexOf(vr.type) == -1) {
                rawValues = rawValue;
                values = value;
                if (typeof value === "string") {
                    const delimiterChar = String.fromCharCode(VM_DELIMITER);
                    rawValues = vr.dropPadByte(rawValue.split(delimiterChar));
                    values = vr.dropPadByte(value.split(delimiterChar));
                }
            } else if (vr.type == "SQ") {
                rawValues = rawValue;
                values = value;
            } else if (vr.type == "OW" || vr.type == "OB") {
                rawValues = rawValue;
                values = value;
            } else {
                Array.isArray(value) ? (values = value) : values.push(value);
                Array.isArray(rawValue)
                    ? (rawValues = rawValue)
                    : rawValues.push(rawValue);
            }
        }
        stream.setEndian(oldEndian);

        const retObj = StreamValueRepresentation.addTagAccessors({
            tag: tag,
            vr: vr
        });
        retObj.values = values;
        retObj.rawValues = rawValues;
        return retObj;
    }

    static async _read(
        stream,
        syntax,
        options = {
            ignoreErrors: false,
            untilTag: null,
            includeUntilTagValue: false
        }
    ) {
        const { ignoreErrors, untilTag } = options;
        let dict = {};

        while (!stream.end()) {
            const readInfo = await DicomMessageAsync._readTag(stream, syntax, options);
            const cleanTagString = readInfo.tag.toCleanString();
            if (cleanTagString === "00080005") {
                if (readInfo.values.length > 0) {
                    let coding = readInfo.values[0];
                    coding = coding.replace(/[_ ]/g, "-").toLowerCase();
                    if (coding in encodingMapping) {
                        coding = encodingMapping[coding];
                        stream.setDecoder(new TextDecoder(coding));
                    } else if (ignoreErrors) {
                        log.warn(
                            `Unsupported character set: ${coding}, using default character set`
                        );
                    } else {
                        throw Error(`Unsupported character set: ${coding}`);
                    }
                }
                if (readInfo.values.length > 1) {
                    if (ignoreErrors) {
                        log.warn(
                            "Using multiple character sets is not supported, proceeding with just the first character set",
                            readInfo.values
                        );
                    } else {
                        throw Error(
                            `Using multiple character sets is not supported: ${readInfo.values}`
                        );
                    }
                }
                readInfo.values = ["ISO_IR 192"]; // change SpecificCharacterSet to UTF-8
            }

            dict[cleanTagString] = StreamValueRepresentation.addTagAccessors({
                vr: readInfo.vr.type
            });
            dict[cleanTagString].Value = readInfo.values;
            dict[cleanTagString]._rawValue = readInfo.rawValues;

            if (untilTag && untilTag === cleanTagString) {
                break;
            }
        }
        return dict;
    }

    /**
     * 
     * @param {string} filename 
     * @param { { ignoreErrors: boolean, untilTag: string, includeUntilTagValue: boolean, noCopy: boolean, forceStoreRaw: boolean } } options
     */
    static async readFile(filename, options) {
        let useSyntax = EXPLICIT_LITTLE_ENDIAN;
        const bufferStream = new DicomReadableBufferStream(
            filename,
            null
        );
        await bufferStream.increment(128);
        if (await bufferStream.readAsciiString(4) !== "DICM") {
            throw new Error("Invalid DICOM file, expected header is missing");
        }

        let el = await DicomMessageAsync._readTag(bufferStream, useSyntax);
        if (el.tag.toCleanString() !== "00020000") {
            throw new Error(
                "Invalid DICOM file, meta length tag is malformed or not present."
            );
        }

        let metaLength = el.values[0];

        let metaReadBufferStream = await bufferStream.readNBytes(metaLength);
        let metaStream = new ReadBufferStream(new Uint8Array(metaReadBufferStream).buffer);
        const metaHeader = await DicomMessage._read(metaStream, useSyntax, options);

        let mainSyntax = metaHeader["00020010"].Value[0];
        if (mainSyntax === DEFLATED_EXPLICIT_LITTLE_ENDIAN) {
            throw new Error("Deflated Explicit Little Endian is not supported");
        }

        mainSyntax = DicomMessage._normalizeSyntax(mainSyntax);
        let objects = await DicomMessageAsync._read(bufferStream, mainSyntax, options);

        let dicomDict = new DicomDict(metaHeader);
        dicomDict.dict = objects;

        return dicomDict;
    }
}

export { DicomMessageAsync };