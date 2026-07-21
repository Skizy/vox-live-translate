class MicrophoneCaptureProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        this.frameSize = options.processorOptions?.frameSize ?? 2048;
        this.frame = new Float32Array(this.frameSize);
        this.frameOffset = 0;
    }

    process(inputs, outputs) {
        const input = inputs[0]?.[0];
        const output = outputs[0]?.[0];

        if (output) {
            output.fill(0);
        }

        if (!input) {
            return true;
        }

        let inputOffset = 0;
        while (inputOffset < input.length) {
            const samplesToCopy = Math.min(this.frameSize - this.frameOffset, input.length - inputOffset);
            this.frame.set(input.subarray(inputOffset, inputOffset + samplesToCopy), this.frameOffset);
            this.frameOffset += samplesToCopy;
            inputOffset += samplesToCopy;

            if (this.frameOffset === this.frameSize) {
                this.port.postMessage(this.frame.buffer, [this.frame.buffer]);
                this.frame = new Float32Array(this.frameSize);
                this.frameOffset = 0;
            }
        }

        return true;
    }
}

registerProcessor("microphone-capture", MicrophoneCaptureProcessor);
