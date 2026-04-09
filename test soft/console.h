// console.h
#pragma once
#include "ParrotOS_API.h"

#define MAX_BUFFER_COLS 256
#define MAX_BUFFER_ROWS 100

typedef struct {
    CHAR16 Char;
    uint32_t FG; 
    uint32_t BG; 
} COLORED_CHAR;

void ConsoleInit(uint32_t screen_width, uint32_t screen_height);
void ConsoleClear();
void ScrollUp();
void PrintChar(CHAR16 c, uint32_t fg, uint32_t bg);
void PrintString(const CHAR16* str, uint32_t fg, uint32_t bg);
void RenderConsole();
CHAR16* Read();
CHAR16 ReadChar();
CHAR16* ReadLine();