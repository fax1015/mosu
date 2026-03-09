import { beatmapApi } from '../bridge/Tauri.js';
import { isAbsolutePath } from './Helpers.js';

const audioSourceCache = new Map();

const hasAudioExtension = (filePath) => (
    /\.(?:mp3|ogg|oga|opus|wav|flac|m4a|mp4|aac|webm)$/i.test(String(filePath || ''))
);

const shouldUseBlobAudio = (filePath) => (
    isAbsolutePath(filePath)
    && !hasAudioExtension(filePath)
);

export const getAudioSourceUrl = async (filePath, fileNameHint = '') => {
    if (!filePath) {
        return '';
    }

    if (!shouldUseBlobAudio(filePath) && beatmapApi?.convertFileSrc) {
        return beatmapApi.convertFileSrc(filePath);
    }

    if (audioSourceCache.has(filePath)) {
        return audioSourceCache.get(filePath);
    }

    if (!beatmapApi?.readAudio) {
        return '';
    }

    const audioSrc = await beatmapApi.readAudio(filePath, fileNameHint);
    if (!audioSrc) {
        return '';
    }
    audioSourceCache.set(filePath, audioSrc);
    return audioSrc;
};
