#ifndef WAV_H
#define WAV_H

#pragma pack(1)
typedef struct {
    UINT32 ChunkID;       // "RIFF"
    UINT32 ChunkSize;
    UINT32 Format;        // "WAVE"
    UINT32 Subchunk1ID;   // "fmt "
    UINT32 Subchunk1Size; // 16 для PCM
    UINT16 AudioFormat;   // 1
    UINT16 NumChannels;   // 1 (Mono) или 2 (Stereo)
    UINT32 SampleRate;    // 44100, 22050 и т.д.
    UINT32 ByteRate;      // SampleRate * NumChannels * BitsPerSample/8
    UINT16 BlockAlign;
    UINT16 BitsPerSample; // 8, 16
    UINT32 Subchunk2ID;   // "data"
    UINT32 Subchunk2Size; // Размер самих данных звука
} WAV_HEADER;
#pragma pack()

typedef struct {
    CHAR16 FileName[64]; // Путь к файлу
} AUDIO_TRACK;

typedef struct {
    AUDIO_TRACK* Playlist; // Массив треков
    UINTN TrackCount;      // Сколько всего треков
    UINTN CurrentIndex;    // Какой сейчас играет
    BOOLEAN IsLooping;     // Зацикливать ли
    BOOLEAN IsActive;      // Работает ли плеер
} AUDIO_PLAYER_STATE;

#endif