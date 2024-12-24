import dcmjs from "dcmjs";
const { Tag } = dcmjs.data;

class TagAsync extends Tag {
    static fromNumbers(group, element) {
        return new TagAsync(((group << 16) | element) >>> 0);
    }

    static async readTag(stream) {
        let group = await stream.readUint16();
        let element = await stream.readUint16();

        return TagAsync.fromNumbers(group, element);
    }
}

export { TagAsync };