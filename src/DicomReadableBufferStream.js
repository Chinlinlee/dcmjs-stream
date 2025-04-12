import { createReadStream } from "fs";

class DicomReadableBufferStream {
    /**
     * 
     * @param {string} filename 
     * @param {boolean} littleEndian 
     */
    constructor(filename, littleEndian) {
        this.isLittleEndian = littleEndian || false;
        this.offset = 0;
        this.size = 0;
        this.encoder = new TextEncoder("utf-8");

        this.isStreamEnded = false

        
        this.fileStream = createReadStream(filename);

        this.fileStream.on('end', () => {
            this.isStreamEnded = true;
        });

        this.remainingBuffer = Buffer.alloc(0);
        this.decoder = new TextDecoder("latin1");
    }

    async readNBytes(n) {
        return new Promise((resolve, reject) => {
            
            if (this.remainingBuffer.length >= n) {
                const result = this.remainingBuffer.subarray(0, n);
                this.remainingBuffer = this.remainingBuffer.subarray(n);
                resolve(result);
                return;
            }

            const chunks = [this.remainingBuffer];
            let bytesRead = this.remainingBuffer.length;

            const onData = (chunk) => {
                chunks.push(chunk);
                bytesRead += chunk.length;

                if (bytesRead >= n) {
                    cleanup();

                    // 合并所有数据块
                    const buffer = Buffer.concat(chunks);
                    // 提取所需的数据
                    const result = buffer.subarray(0, n);
                    // 保存多余的数据
                    this.remainingBuffer = buffer.subarray(n);

                    resolve(result);
                }
            };

            const onEnd = () => {
                cleanup();
                reject(new Error(`Stream ended before reading ${n} bytes`));
            };

            const onError = (err) => {
                cleanup();
                reject(err);
            };

            const cleanup = () => {
                this.fileStream.removeListener('data', onData);
                this.fileStream.removeListener('end', onEnd);
                this.fileStream.removeListener('error', onError);
            };

            
            this.fileStream.on('data', onData);
            this.fileStream.on('end', onEnd);
            this.fileStream.on('error', onError);
        });
    }

    async readToEnd() {
        return new Promise((resolve, reject) => {
            let size = 0;
            const chunks = [this.remainingBuffer];
            size += this.remainingBuffer.length;

            const onData = (chunk) => {
                chunks.push(chunk);
                size += chunk.length;
            };

            const onEnd = () => {
                cleanup();
                
                const buffer = Buffer.concat(chunks);
                this.remainingBuffer = Buffer.alloc(0);
                resolve(buffer);
            };

            const onError = (err) => {
                cleanup();
                reject(err);
            };

            const cleanup = () => {
                this.fileStream.removeListener('data', onData);
                this.fileStream.removeListener('end', onEnd);
                this.fileStream.removeListener('error', onError);
            };

            // 添加事件监听器
            this.fileStream.on('data', onData);
            this.fileStream.on('end', onEnd);
            this.fileStream.on('error', onError);
        });
    }

    // 用于关闭流的方法
    close() {
        if (this.fileStream) {
            this.fileStream.destroy();
        }
    }

    async readUint16() {
        const buffer = await this.readNBytes(2);
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.length);
        return this.isLittleEndian ? view.getUint16(0, true) : view.getUint16(0, false);
    }

    async readUint32() {
        const buffer = await this.readNBytes(4);
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.length);
        return this.isLittleEndian ? view.getUint32(0, true) : view.getUint32(0, false);
    }

    async readInt16() {
        const buffer = await this.readNBytes(2);
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.length);
        return this.isLittleEndian ? view.getInt16(0, true) : view.getInt16(0, false);
    }

    async readInt32() {
        const buffer = await this.readNBytes(4);
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.length);
        return this.isLittleEndian ? view.getInt32(0, true) : view.getInt32(0, false);
    }

    async readFloat() {
        const buffer = await this.readNBytes(4);
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.length);
        return this.isLittleEndian ? view.getFloat32(0, true) : view.getFloat32(0, false);
    }

    async readDouble() {
        const buffer = await this.readNBytes(8);
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.length);
        return this.isLittleEndian ? view.getFloat64(0, true) : view.getFloat64(0, false);
    }

    async readVR() {
        const buffer = await this.readNBytes(2);
        return buffer.toString('ascii');
    }

    async readAsciiString(length) {
        const buffer = await this.readNBytes(length);
        return buffer.toString('ascii');
    }

    async readEncodedString(length) {
        const buffer = await this.readNBytes(length);
        return this.decoder.decode(buffer);
    }

    setEndian(littleEndian) {
        this.isLittleEndian = littleEndian;
    }

    getEndian() {
        return this.isLittleEndian;
    }

    setDecoder(decoder) {
        this.decoder = decoder;
    }

    async increment(n) {
        await this.readNBytes(n);
    }

    end() {
        return this.isStreamEnded && this.remainingBuffer.length === 0;
    }

    async peekUint8(offset = 0) {
        if (this.remainingBuffer.length > offset) {
            return this.remainingBuffer[offset];
        }

        const buffer = await this.readNBytes(offset + 1);
        this.remainingBuffer = Buffer.concat([buffer]);
        return buffer[offset];
    }

    static createFromBuffer(buffer) {
        const stream = new DicomReadableBufferStream();
        stream.remainingBuffer = Buffer.from(buffer);
        return stream;
    }
}

export { DicomReadableBufferStream };