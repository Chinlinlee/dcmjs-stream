import dcmjs from "dcmjs";
const { ValueRepresentation, ReadBufferStream, DicomMessage } = dcmjs.data;
const { dicomJson } = dcmjs.utilities;
import { TagAsync } from "./TagAsync.js";
import {
    VM_DELIMITER,
    PADDING_SPACE,
    PADDING_NULL
} from "./constants/dicom.js";


function rtrim(str) {
    return str.replace(/\s*$/g, "");
}

function toWindows(inputArray, size) {
    return Array.from(
        { length: inputArray.length - (size - 1) }, //get the appropriate length
        (_, index) => inputArray.slice(index, index + size) //create the windows
    );
}

class StreamValueRepresentation extends ValueRepresentation {
    async read(stream, length, syntax, readOptions = { forceStoreRaw: false }) {
        if (this.fixed && this.maxLength) {
            if (!length) return this.defaultValue;
            if (this.maxLength != length)
                log.error(
                    "Invalid length for fixed length tag, vr " +
                    this.type +
                    ", length " +
                    this.maxLength +
                    " != " +
                    length
                );
        }
        let rawValue = await this.readBytes(stream, length, syntax);
        const value = this.applyFormatting(rawValue);
        if (!this.storeRaw() && !readOptions.forceStoreRaw) {
            rawValue = undefined;
        }
        return { rawValue, value };
    }

    async readPaddedAsciiString(stream, length) {
        if (!length) return "";
        if (await stream.peekUint8(length - 1) !== this.padByte) {
            return await stream.readAsciiString(length);
        } else {
            let val = await stream.readAsciiString(length - 1);
            await stream.increment(1);
            return val;
        }
    }

    async readPaddedEncodedString(stream, length) {
        if (!length) return "";
        const val = await stream.readEncodedString(length);
        if (
            val.length &&
            val[val.length - 1] !== String.fromCharCode(this.padByte)
        ) {
            return val;
        } else {
            return val.slice(0, -1);
        }
    }

    static createByTypeString(type) {
        let vr = VRinstances[type];
        if (vr === undefined) {
            if (type == "ox") {
                // TODO: determine VR based on context (could be 1 byte pixel data)
                // https://github.com/dgobbi/vtk-dicom/issues/38
                console.error("Invalid vr type", type, "- using OW");
                vr = VRinstances["OW"];
            } else if (type == "xs") {
                console.error("Invalid vr type", type, "- using US");
                vr = VRinstances["US"];
            } else {
                console.error("Invalid vr type", type, "- using UN");
                vr = VRinstances["UN"];
            }
        }
        return vr;
    }

    static parseUnknownVr(vrType) {
        return new ParsedUnknownValue(vrType);
    }
}

class AsciiStringRepresentation extends StreamValueRepresentation {
    constructor(type) {
        super(type);
    }

    async readBytes(stream, length) {
        return await stream.readAsciiString(length);
    }

    writeBytes(stream, value, writeOptions) {
        const written = super.write(stream, "AsciiString", value);

        return super.writeBytes(stream, value, written, writeOptions);
    }
}

class EncodedStringRepresentation extends StreamValueRepresentation {
    constructor(type) {
        super(type);
    }

    async readBytes(stream, length) {
        return await stream.readEncodedString(length);
    }

    writeBytes(stream, value, writeOptions) {
        const written = super.write(stream, "UTF8String", value);

        return super.writeBytes(stream, value, written, writeOptions);
    }
}

class BinaryRepresentation extends StreamValueRepresentation {

    async readBytes(stream, length) {
        if (length == 0xffffffff) {
            let itemTagValue = await TagAsync.readTag(stream),
                frames = [];
            
            if (itemTagValue.is(0xfffee000)) {
                let itemLength = await stream.readUint32(),
                    numOfFrames = 1,
                    offsets = [];

                if (itemLength > 0x0) {
                    //has frames
                    numOfFrames = itemLength / 4;
                    
                    for (let i = 0; i < numOfFrames; i++) {
                        offsets.push(await stream.readUint32());
                    }
                }

                const SequenceItemTag = 0xfffee000;
                const SequenceDelimiterTag = 0xfffee0dd;

                const getNextSequenceItemData = async stream => {
                    const nextTag = await TagAsync.readTag(stream);
                    if (nextTag.is(SequenceItemTag)) {
                        const itemLength = await stream.readUint32();
                        return await stream.readNBytes(itemLength);
                    } else if (nextTag.is(SequenceDelimiterTag)) {
                        if (await stream.readUint32() !== 0) {
                            throw Error(
                                "SequenceDelimiterItem tag value was not zero"
                            );
                        }
                        return null;
                    }

                    throw Error("Invalid tag in sequence");
                }

                if (offsets.length === 1) {
                    return [await getNextSequenceItemData(stream)];
                } else if (offsets.length > 0) {
                    for(let i = 1 ; i < offsets.length; i++) {            
                        let frameLength = offsets[i] - offsets[i - 1];
                        if(frameLength > 0) {
                            let buffer = await getNextSequenceItemData(stream);
                            frames.push(buffer);
                        }
                    }
                    
                    frames.push(await getNextSequenceItemData(stream));

                } else {
                    // If no offset table, loop through remainder of stream looking for termination tag
                    while (!stream.end()) {
                        const buffer = await getNextSequenceItemData(stream);
                        if (buffer === null) break;
                        frames.push(buffer);
                    }
                }
            }
            
            return frames;
        } else {
            let bytes = await stream.readNBytes(length);
            return [bytes];
        }
    }
}

class ApplicationEntity extends AsciiStringRepresentation {
    constructor() {
        super("AE");
        this.maxLength = 16;
        this.padByte = PADDING_SPACE;
    }

    async readBytes(stream, length) {
        return await stream.readAsciiString(length);
    }

    applyFormatting(value) {
        return value.trim();
    }
}

class CodeString extends AsciiStringRepresentation {
    constructor() {
        super("CS");
        this.maxLength = 16;
        this.padByte = PADDING_SPACE;
    }

    async readBytes(stream, length) {
        const BACKSLASH = String.fromCharCode(VM_DELIMITER);
        return this.dropPadByte(
            (await stream.readAsciiString(length)).split(BACKSLASH)
        );
    }

    applyFormatting(value) {
        const trim = str => str.trim();

        if (Array.isArray(value)) {
            return value.map(str => trim(str));
        }

        return trim(value);
    }
}

class AgeString extends AsciiStringRepresentation {
    constructor() {
        super("AS");
        this.maxLength = 4;
        this.padByte = PADDING_SPACE;
        this.fixed = true;
        this.defaultValue = "";
    }
}

class AttributeTag extends StreamValueRepresentation {
    constructor() {
        super("AT");
        this.maxLength = 4;
        this.valueLength = 4;
        this.padByte = PADDING_NULL;
        this.fixed = true;
    }

    async readBytes(stream) {
        return (await TagAsync.readTag(stream)).value;
    }

    writeBytes(stream, value, writeOptions) {
        return super.writeBytes(
            stream,
            value,
            super.write(stream, "TwoUint16s", value),
            writeOptions
        );
    }
}

class DateValue extends AsciiStringRepresentation {
    constructor(value) {
        super("DA", value);
        this.maxLength = 8;
        this.padByte = PADDING_SPACE;
        //this.fixed = true;
        this.defaultValue = "";
    }
}

class NumericStringRepresentation extends AsciiStringRepresentation {
    async readBytes(stream, length) {
        const BACKSLASH = String.fromCharCode(VM_DELIMITER);
        const numStr = await stream.readAsciiString(length);

        return this.dropPadByte(numStr.split(BACKSLASH));
    }
}

class DecimalString extends NumericStringRepresentation {
    constructor() {
        super("DS");
        this.maxLength = 16;
        this.padByte = PADDING_SPACE;
    }

    applyFormatting(value) {
        const formatNumber = numberStr => {
            let returnVal = numberStr.trim().replace(/[^0-9.\\\-+e]/gi, "");
            return returnVal === "" ? null : Number(returnVal);
        };

        if (Array.isArray(value)) {
            return value.map(formatNumber);
        }

        return formatNumber(value);
    }

    convertToString(value) {
        if (value === null) return "";
        if (typeof value === "string") return value;

        let str = String(value);
        if (str.length > this.maxLength) {
            // Characters needed for '-' at start.
            const sign_chars = value < 0 ? 1 : 0;

            // Decide whether to use scientific notation.
            const logval = Math.log10(Math.abs(value));

            // Numbers larger than 1e14 cannot be correctly represented by truncating
            // their string representations to 16 chars, e.g pi * 10^13 would become
            // '314159265358979.', which may not be universally understood. This limit
            // is 1e13 for negative numbers because of the minus sign.
            // For negative exponents, the point of equal precision between scientific
            // and standard notation is 1e-4 e.g. '0.00031415926535' and
            // '3.1415926535e-04' are both 16 chars.
            const use_scientific = logval < -4 || logval >= 14 - sign_chars;
            if (use_scientific) {
                const trunc_str = value.toExponential(16 - sign_chars);
                if (trunc_str.length <= 16) return trunc_str;
                // If string is too long, correct the length.
                return value.toExponential(
                    16 - (trunc_str.length - 16) - sign_chars
                );
            } else {
                const trunc_str = value.toFixed(16 - sign_chars);
                if (trunc_str.length <= 16) return trunc_str;
                // If string is too long, correct the length.
                return value.toFixed(16 - sign_chars - (trunc_str.length - 16));
            }
        }
        return str;
    }

    writeBytes(stream, value, writeOptions) {
        const val = Array.isArray(value)
            ? value.map(ds => this.convertToString(ds))
            : [this.convertToString(value)];
        return super.writeBytes(stream, val, writeOptions);
    }
}

class DateTime extends AsciiStringRepresentation {
    constructor() {
        super("DT");
        this.maxLength = 26;
        this.padByte = PADDING_SPACE;
    }
}

class FloatingPointSingle extends StreamValueRepresentation {
    constructor() {
        super("FL");
        this.maxLength = 4;
        this.padByte = PADDING_NULL;
        this.fixed = true;
        this.defaultValue = 0.0;
    }

    async readBytes(stream) {
        return await stream.readFloat();
    }

    applyFormatting(value) {
        return Number(value);
    }

    writeBytes(stream, value, writeOptions) {
        return super.writeBytes(
            stream,
            value,
            super.write(stream, "Float", value),
            writeOptions
        );
    }
}

class FloatingPointDouble extends StreamValueRepresentation {
    constructor() {
        super("FD");
        this.maxLength = 8;
        this.padByte = PADDING_NULL;
        this.fixed = true;
        this.defaultValue = 0.0;
    }

    async readBytes(stream) {
        return await stream.readDouble();
    }

    applyFormatting(value) {
        return Number(value);
    }

    writeBytes(stream, value, writeOptions) {
        return super.writeBytes(
            stream,
            value,
            super.write(stream, "Double", value),
            writeOptions
        );
    }
}

class IntegerString extends NumericStringRepresentation {
    constructor() {
        super("IS");
        this.maxLength = 12;
        this.padByte = PADDING_SPACE;
    }

    applyFormatting(value) {
        const formatNumber = numberStr => {
            let returnVal = numberStr.trim().replace(/[^0-9.\\\-+e]/gi, "");
            return returnVal === "" ? null : Number(returnVal);
        };

        if (Array.isArray(value)) {
            return value.map(formatNumber);
        }

        return formatNumber(value);
    }

    convertToString(value) {
        if (typeof value === "string") return value;
        return value === null ? "" : String(value);
    }

    writeBytes(stream, value, writeOptions) {
        const val = Array.isArray(value)
            ? value.map(is => this.convertToString(is))
            : [this.convertToString(value)];
        return super.writeBytes(stream, val, writeOptions);
    }
}

class LongString extends EncodedStringRepresentation {
    constructor() {
        super("LO");
        this.maxCharLength = 64;
        this.padByte = PADDING_SPACE;
    }

    async readBytes(stream, length) {
        return await stream.readEncodedString(length);
    }

    applyFormatting(value) {
        return value.trim();
    }
}

class LongText extends EncodedStringRepresentation {
    constructor() {
        super("LT");
        this.maxCharLength = 10240;
        this.padByte = PADDING_SPACE;
    }

    async readBytes(stream, length) {
        return await stream.readEncodedString(length);
    }

    applyFormatting(value) {
        return rtrim(value);
    }
}

class PersonName extends EncodedStringRepresentation {
    constructor() {
        super("PN");
        this.maxLength = null;
        this.padByte = PADDING_SPACE;
    }

    static checkComponentLengths(components) {
        for (var i in components) {
            var cmp = components[i];
            // As per table 6.2-1 in the spec
            if (cmp.length > 64) return false;
        }
        return true;
    }

    // Adds toJSON and toString accessors to normalize PersonName output; ie toJSON
    // always returns a dicom+json object, and toString always returns a part10
    // style string, regardless of typeof value
    addValueAccessors(value) {
        if (typeof value === "string") {
            value = new String(value);
        }
        if (value != undefined) {
            if (typeof value === "object") {
                return dicomJson.pnAddValueAccessors(value);
            } else {
                throw new Error(
                    "Cannot add accessors to non-string primitives"
                );
            }
        }
        return value;
    }

    // Only checked on write, not on read nor creation
    checkLength(value) {
        if (Array.isArray(value)) {
            // In DICOM JSON, components are encoded as a mapping (object),
            // where the keys are one or more of the following: "Alphabetic",
            // "Ideographic", "Phonetic".
            // http://dicom.nema.org/medical/dicom/current/output/chtml/part18/sect_F.2.2.html
            for (const pnValue of value) {
                const components = Object.keys(pnValue).forEach(
                    key => value[key]
                );
                if (!PersonName.checkComponentLengths(components)) return false;
            }
        } else if (typeof value === "string" || value instanceof String) {
            // In DICOM Part10, components are encoded as a string,
            // where components ("Alphabetic", "Ideographic", "Phonetic")
            // are separated by the "=" delimeter.
            // http://dicom.nema.org/medical/dicom/current/output/chtml/part05/sect_6.2.html
            // PN may also have multiplicity, with each item separated by
            // 0x5C (backslash).
            // https://dicom.nema.org/dicom/2013/output/chtml/part05/sect_6.4.html
            const values = value.split(String.fromCharCode(VM_DELIMITER));

            for (var pnString of values) {
                const components = pnString.split(
                    String.fromCharCode(PN_COMPONENT_DELIMITER)
                );
                if (!PersonName.checkComponentLengths(components)) return false;
            }
        }
        return true;
    }

    async readBytes(stream, length) {
        let paddedString = await this.readPaddedEncodedString(stream, length);

        return paddedString.split(
            String.fromCharCode(VM_DELIMITER)
        );
    }

    applyFormatting(value) {
        const parsePersonName = valueStr =>
            dicomJson.pnConvertToJsonObject(valueStr, false);

        if (Array.isArray(value)) {
            return value.map(valueStr => parsePersonName(valueStr));
        }

        return parsePersonName(value);
    }

    writeBytes(stream, value, writeOptions) {
        return super.writeBytes(
            stream,
            dicomJson.pnObjectToString(value),
            writeOptions
        );
    }
}

class ShortString extends EncodedStringRepresentation {
    constructor() {
        super("SH");
        this.maxCharLength = 16;
        this.padByte = PADDING_SPACE;
    }

    async readBytes(stream, length) {
        return await stream.readEncodedString(length);
    }

    applyFormatting(value) {
        return value.trim();
    }
}

class SignedLong extends StreamValueRepresentation {
    constructor() {
        super("SL");
        this.maxLength = 4;
        this.padByte = PADDING_NULL;
        this.fixed = true;
        this.defaultValue = 0;
    }

    async readBytes(stream) {
        return await stream.readInt32();
    }

    writeBytes(stream, value, writeOptions) {
        return super.writeBytes(
            stream,
            value,
            super.write(stream, "Int32", value),
            writeOptions
        );
    }
}

class SequenceOfItems extends StreamValueRepresentation {
    constructor() {
        super("SQ");
        this.maxLength = null;
        this.padByte = PADDING_NULL;
        this.noMultiple = true;
        this._storeRaw = false;
    }

    async readBytes(stream, sqlength, syntax) {
        if (sqlength == 0x0) {
            return []; //contains no dataset
        } else {

            let undefLength = sqlength == 0xffffffff,
                elements = [],
                read = 0;

            while (true) {
                let tag = await TagAsync.readTag(stream);

                let length = null;

                read += 4;

                if (tag.is(0xfffee0dd)) {
                    await stream.readUint32();
                    break;
                } else if (!undefLength && read == sqlength) {
                    break;
                } else if (tag.is(0xfffee000)) {
                    length = await stream.readUint32();
                    read += 4;
                    
                    let undef = length == 0xffffffff;
                    if (undef) {
                        let toRead = 0;
                        let stack = 0;
                        let tempBuffer = Buffer.alloc(0);
                        while (true) {
                            const g = await stream.readUint16();
                            if (g == 0xfffe) {
                                const ge = await stream.readUint16();
                                const itemLength = await stream.readUint32();

                                // 存储读取的数据
                                tempBuffer = Buffer.concat([
                                    tempBuffer,
                                    Buffer.from([0xfe, 0xff]), // g
                                    Buffer.from([ge & 0xff, ge >> 8]), // ge
                                    Buffer.from([
                                        itemLength & 0xff,
                                        (itemLength >> 8) & 0xff,
                                        (itemLength >> 16) & 0xff,
                                        (itemLength >> 24) & 0xff
                                    ])
                                ]);
                                if (ge == 0xe00d) {
                                    if (itemLength === 0) {
                                        stack--;
                                        if (stack < 0) {
                                            toRead = tempBuffer.length - 8; // 减去最后的分隔符长度
                                            break;
                                        }
                                    }
                                } else if (ge == 0xe000) {
                                    if (itemLength == 0xffffffff) {
                                        stack++;
                                    }
                                }
                            } else {
                                tempBuffer = Buffer.concat([
                                    tempBuffer,
                                    Buffer.from([g & 0xff, g >> 8])
                                ]);
                            }
                        }
                        if (toRead > 0) {
                            const itemStream = new ReadBufferStream(
                                new Uint8Array(tempBuffer.slice(0, toRead)).buffer,
                                stream.isLittleEndian
                            );
                            read += toRead + 8; // 加上分隔符的长度
                            const items = await DicomMessage._read(itemStream, syntax);
                            elements.push(items);

                        }
                    } else {
                        // 处理定长序列项
                        if (length > 0) {
                            const itemData = await stream.readNBytes(length);
                            const itemStream = new ReadBufferStream(
                                new Uint8Array(itemData).buffer,
                                stream.isLittleEndian
                            );
                            read += length;
                            const items = await DicomMessage._read(itemStream, syntax);
                            elements.push(items);
                        }
                    }

                    if (!undefLength && read == sqlength) {
                        break;
                    }
                }
            }

            return elements;
        }
    }

    writeBytes(stream, value, syntax, writeOptions) {
        let written = 0;

        if (value) {
            for (var i = 0; i < value.length; i++) {
                var item = value[i];
                super.write(stream, "Uint16", 0xfffe);
                super.write(stream, "Uint16", 0xe000);
                super.write(stream, "Uint32", 0xffffffff);

                written += DicomMessage.write(
                    item,
                    stream,
                    syntax,
                    writeOptions
                );

                super.write(stream, "Uint16", 0xfffe);
                super.write(stream, "Uint16", 0xe00d);
                super.write(stream, "Uint32", 0x00000000);
                written += 16;
            }
        }
        super.write(stream, "Uint16", 0xfffe);
        super.write(stream, "Uint16", 0xe0dd);
        super.write(stream, "Uint32", 0x00000000);
        written += 8;

        return super.writeBytes(stream, value, [written], writeOptions);
    }
}

class SignedShort extends StreamValueRepresentation {
    constructor() {
        super("SS");
        this.maxLength = 2;
        this.valueLength = 2;
        this.padByte = PADDING_NULL;
        this.fixed = true;
        this.defaultValue = 0;
    }

    async readBytes(stream) {
        return await stream.readInt16();
    }

    writeBytes(stream, value, writeOptions) {
        return super.writeBytes(
            stream,
            value,
            super.write(stream, "Int16", value),
            writeOptions
        );
    }
}

class ShortText extends EncodedStringRepresentation {
    constructor() {
        super("ST");
        this.maxCharLength = 1024;
        this.padByte = PADDING_SPACE;
    }

    async readBytes(stream, length) {
        return await stream.readEncodedString(length);
    }

    applyFormatting(value) {
        return rtrim(value);
    }
}

class TimeValue extends AsciiStringRepresentation {
    constructor() {
        super("TM");
        this.maxLength = 14;
        this.padByte = PADDING_SPACE;
    }

    async readBytes(stream, length) {
        return await stream.readAsciiString(length);
    }

    applyFormatting(value) {
        return rtrim(value);
    }
}

class UnlimitedCharacters extends EncodedStringRepresentation {
    constructor() {
        super("UC");
        this.maxLength = null;
        this.multi = true;
        this.padByte = PADDING_SPACE;
    }

    async readBytes(stream, length) {
        return await stream.readEncodedString(length);
    }

    applyFormatting(value) {
        return rtrim(value);
    }
}

class UnlimitedText extends EncodedStringRepresentation {
    constructor() {
        super("UT");
        this.maxLength = null;
        this.padByte = PADDING_SPACE;
    }

    async readBytes(stream, length) {
        return await stream.readEncodedString(length);
    }

    applyFormatting(value) {
        return rtrim(value);
    }
}

class UnsignedShort extends StreamValueRepresentation {
    constructor() {
        super("US");
        this.maxLength = 2;
        this.padByte = PADDING_NULL;
        this.fixed = true;
        this.defaultValue = 0;
    }

    async readBytes(stream) {
        return await stream.readUint16();
    }

    writeBytes(stream, value, writeOptions) {
        return super.writeBytes(
            stream,
            value,
            super.write(stream, "Uint16", value),
            writeOptions
        );
    }
}

class UnsignedLong extends StreamValueRepresentation {
    constructor() {
        super("UL");
        this.maxLength = 4;
        this.padByte = PADDING_NULL;
        this.fixed = true;
        this.defaultValue = 0;
    }

    async readBytes(stream) {
        return await stream.readUint32();
    }

    writeBytes(stream, value, writeOptions) {
        return super.writeBytes(
            stream,
            value,
            super.write(stream, "Uint32", value),
            writeOptions
        );
    }
}

class UniqueIdentifier extends AsciiStringRepresentation {
    constructor() {
        super("UI");
        this.maxLength = 64;
        this.padByte = PADDING_NULL;
    }

    async readBytes(stream, length) {
        const result = await this.readPaddedAsciiString(stream, length);

        const BACKSLASH = String.fromCharCode(VM_DELIMITER);

        // Treat backslashes as a delimiter for multiple UIDs, in which case an
        // array of UIDs is returned. This is used by DICOM Q&R to support
        // querying and matching multiple items on a UID field in a single
        // query. For more details see:
        //
        // https://dicom.nema.org/medical/dicom/current/output/chtml/part04/sect_C.2.2.2.2.html
        // https://dicom.nema.org/medical/dicom/current/output/chtml/part05/sect_6.4.html

        if (result.indexOf(BACKSLASH) === -1) {
            return result;
        } else {
            return this.dropPadByte(result.split(BACKSLASH));
        }
    }

    applyFormatting(value) {
        const removeInvalidUidChars = uidStr => {
            return uidStr.replace(/[^0-9.]/g, "");
        };

        if (Array.isArray(value)) {
            return value.map(removeInvalidUidChars);
        }

        return removeInvalidUidChars(value);
    }
}

class UniversalResource extends AsciiStringRepresentation {
    constructor() {
        super("UR");
        this.maxLength = null;
        this.padByte = PADDING_SPACE;
    }

    async readBytes(stream, length) {
        return await stream.readAsciiString(length);
    }
}

class UnknownValue extends BinaryRepresentation {
    constructor() {
        super("UN");
        this.maxLength = null;
        this.padByte = PADDING_NULL;
        this.noMultiple = true;
    }
}

class ParsedUnknownValue extends BinaryRepresentation {
    constructor(vr) {
        super(vr);
        this.maxLength = null;
        this.padByte = 0;
        this.noMultiple = true;
        this._isBinary = true;
        this._allowMultiple = false;
        this._isExplicit = true;
        this._storeRaw = true;
    }

    async read(stream, length, syntax, readOptions) {
        const arrayBuffer = await this.readBytes(stream, length, syntax)[0];
        const streamFromBuffer = new ReadBufferStream(arrayBuffer, true);
        const vr = ValueRepresentation.createByTypeString(this.type);

        if (vr.isBinary() && length > vr.maxLength && !vr.noMultiple) {
            let values = [];
            let rawValues = [];
            let times = length / vr.maxLength,
                i = 0;

            while (i++ < times) {
                const { rawValue, value } = vr.read(
                    streamFromBuffer,
                    vr.maxLength,
                    syntax,
                    readOptions
                );
                rawValues.push(rawValue);
                values.push(value);
            }
            return { rawValue: rawValues, value: values };
        } else {
            return vr.read(streamFromBuffer, length, syntax, readOptions);
        }
    }
}

class OtherWordString extends BinaryRepresentation {
    constructor() {
        super("OW");
        this.maxLength = null;
        this.padByte = PADDING_NULL;
        this.noMultiple = true;
    }
}

class OtherByteString extends BinaryRepresentation {
    constructor() {
        super("OB");
        this.maxLength = null;
        this.padByte = PADDING_NULL;
        this.noMultiple = true;
    }
}

class OtherDoubleString extends BinaryRepresentation {
    constructor() {
        super("OD");
        this.maxLength = null;
        this.padByte = PADDING_NULL;
        this.noMultiple = true;
    }
}

class OtherFloatString extends BinaryRepresentation {
    constructor() {
        super("OF");
        this.maxLength = null;
        this.padByte = PADDING_NULL;
        this.noMultiple = true;
    }
}

let VRinstances = {
    AE: new ApplicationEntity(),
    AS: new AgeString(),
    AT: new AttributeTag(),
    CS: new CodeString(),
    DA: new DateValue(),
    DS: new DecimalString(),
    DT: new DateTime(),
    FL: new FloatingPointSingle(),
    FD: new FloatingPointDouble(),
    IS: new IntegerString(),
    LO: new LongString(),
    LT: new LongText(),
    OB: new OtherByteString(),
    OD: new OtherDoubleString(),
    OF: new OtherFloatString(),
    OW: new OtherWordString(),
    PN: new PersonName(),
    SH: new ShortString(),
    SL: new SignedLong(),
    SQ: new SequenceOfItems(),
    SS: new SignedShort(),
    ST: new ShortText(),
    TM: new TimeValue(),
    UC: new UnlimitedCharacters(),
    UI: new UniqueIdentifier(),
    UL: new UnsignedLong(),
    UN: new UnknownValue(),
    UR: new UniversalResource(),
    US: new UnsignedShort(),
    UT: new UnlimitedText()
};

export { StreamValueRepresentation };