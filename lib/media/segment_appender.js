goog.provide('shaka.media.SegmentAppender');

goog.require('shaka.media.MediaSourceEngine');
goog.require('shaka.media.StreamingEngine');

shaka.media.SegmentAppender = class {
  /**
  * @param {!shaka.media.MediaSourceEngine} mediaSourceEngine
  * @param {!shaka.media.StreamingEngine.MediaState_} mediaState
  * @param {!shaka.extern.Period} period
  * @param {!shaka.media.SegmentReference} segmentReference
  * @param {!shaka.extern.Stream} stream
  * @param {!shaka.media.StreamingEngine} streamingEngine
  */
  constructor(mediaSourceEngine, mediaState, period, segmentReference, stream,
      streamingEngine) {
    this.mediaSourceEngine = mediaSourceEngine;
    this.mediaState = mediaState;
    this.period = period;
    this.segmentReference = segmentReference;
    this.stream = stream;
    this.streamingEngine = streamingEngine;

    this.buffer_ = new Uint8Array(0);
    this.offset_ = 0;
    this.bufferSize_ = 0;
  }

  /**
  * @param {!Uint8Array} data
  */
  async onSegmentBoxReady(data) {
    if (this.mediaSourceEngine.ended()) {
      return;
    }
    const hasClosedCaptions = this.stream.closedCaptions &&
        this.stream.closedCaptions.size > 0;
    const startTime = this.segmentReference.startTime;
    const endTime = this.segmentReference.endTime;
    try {
      await this.mediaSourceEngine.appendBuffer(this.mediaState.type, data,
          startTime, endTime, hasClosedCaptions);
      this.mediaState.lastStream = this.stream;
      this.mediaState.lastSegmentReference = this.segmentReference;
    } catch (error) {
      shaka.log.warning('error appending chunk', error);
    }
  }

  /**
   * @param {Object} readObj
   */
  async onReadUpdate(readObj) {
    if (readObj.done) {
      if (this.buffer_ && this.buffer_.length > 0) {
        // Only append after init segment
        if (this.mediaState.initSegmentAppended) {
          this.onSegmentBoxReady(this.buffer_);
        }
      }
      this.streamingEngine.onSegmentAppendCompleted(
          this.mediaState, this.stream);
    } else if (readObj.value && readObj.value.length > 0) {
      this.buffer_ = shaka.media.SegmentAppender
          .concatData(this.buffer_, readObj.value);

      const boxesInfo = shaka.media.SegmentAppender
          .findLastBoxCompleted(['moov', 'mdat'],
              this.buffer_, this.offset_);
      if (boxesInfo.found && this.mediaState.initSegmentAppended) {
        const end = boxesInfo.offset + boxesInfo.size;
        let data;
        if (end === this.bufferSize_) {
          data = this.buffer_;
          this.buffer_ = new Uint8Array(0);
          this.bufferSize_ = 0;
        } else {
          data = this.buffer_.subarray(0, end);
          this.buffer_ = this.buffer_.subarray(end);
        }
        this.bufferSize_ = this.buffer_.length;
        if (data) {
          await this.onSegmentBoxReady(data);
        }
        this.offset_ = 0;
      }
    }
  }

  /**
   * @param {Array} types
   * @param {Uint8Array} buffer
   * @param {number} offset
   * @return {Object}
   */
  static findLastBoxCompleted(types, buffer, offset) {
    if (offset === undefined) {
      offset = 0;
    }

    // 8 = size(4 char) + type(4 char)
    if (!buffer || offset + 8 >= buffer.byteLength) {
      return {found: false};
    }

    let boxInfo;
    let lastOffset = 0;
    while (offset < buffer.byteLength) {
      const size = shaka.media.SegmentAppender.parseUint32(buffer, offset);
      const type = shaka.media.SegmentAppender.parseBoxType(buffer, offset+4);
      if (size === 0) {
        break;
      }

      if (offset + size <= buffer.byteLength) {
        if (types.includes(type)) {
          boxInfo = {found: true, offset: lastOffset, size: size};
        } else {
          lastOffset = offset + size;
        }
      }
      offset += size;
    }

    if (!boxInfo) {
      return {found: false, offset: lastOffset};
    }
    return boxInfo;
  }

  /**
   * @param {Uint8Array} remaining
   * @param {Uint8Array} data
   * @return {Uint8Array}
   */
  static concatData(remaining, data) {
    if (remaining.length === 0) {
      return data;
    }
    const result = new Uint8Array(remaining.length + data.length);
    result.set(remaining);
    result.set(data, remaining.length);
    return result;
  }

  /**
   * @param {Uint8Array} data
   * @param {number} offset
   * @return {number}
   */
  static parseUint32(data, offset) {
    return (data[offset + 3] >>> 0) |
          ((data[offset + 2] << 8) >>> 0) |
          ((data[offset + 1] << 16) >>> 0) |
          ((data[offset] << 24) >>> 0);
  }

  /**
   * @param {Uint8Array} data
   * @param {number} offset
   * @return {string}
   */
  static parseBoxType(data, offset) {
    return String.fromCharCode(data[offset++]) +
          String.fromCharCode(data[offset++]) +
          String.fromCharCode(data[offset++]) +
          String.fromCharCode(data[offset]);
  }
};
