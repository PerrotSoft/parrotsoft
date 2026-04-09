// console.c
#include "console.h"

static COLORED_CHAR screen_buffer[MAX_BUFFER_ROWS][MAX_BUFFER_COLS];
static int cursor_x = 0;
static int cursor_y = 0;

static uint32_t global_fg = 0xCCCCCC;
static uint32_t global_bg = 0x050505;

static int console_cols = 80;
static int console_rows = 25;
static int char_w = 4;
static int char_h = 8;
static int font_size = 10;

#define OFFSET_X 10
#define OFFSET_Y 10

void ConsoleInit(uint32_t screen_width, uint32_t screen_height) {
    if (screen_width >= 1920) {
        char_w = 12;
        char_h = 24;
        font_size = 30;
    } else if (screen_width >= 1024) {
        char_w = 8;
        char_h = 16;
        font_size = 20;
    } else {
        char_w = 4;
        char_h = 8;
        font_size = 10;
    }

    console_cols = (screen_width - (OFFSET_X * 2)) / char_w;
    console_rows = (screen_height - (OFFSET_Y * 2)) / char_h;

    if (console_cols > MAX_BUFFER_COLS) console_cols = MAX_BUFFER_COLS;
    if (console_rows > MAX_BUFFER_ROWS) console_rows = MAX_BUFFER_ROWS;

    ConsoleClear();
}

void ConsoleClear() {
    for (int y = 0; y < console_rows; y++) {
        for (int x = 0; x < console_cols; x++) {
            screen_buffer[y][x].Char = 0;
            screen_buffer[y][x].FG = global_fg;
            screen_buffer[y][x].BG = global_bg;
        }
    }
    cursor_x = 0;
    cursor_y = 0;
}

void ScrollUp() {
    for (int y = 0; y < console_rows - 1; y++) {
        for (int x = 0; x < console_cols; x++) {
            screen_buffer[y][x] = screen_buffer[y + 1][x];
        }
    }
    for (int x = 0; x < console_cols; x++) {
        screen_buffer[console_rows - 1][x].Char = 0;
        screen_buffer[console_rows - 1][x].FG = global_fg;
        screen_buffer[console_rows - 1][x].BG = global_bg;
    }
    cursor_y = console_rows - 1;
}

void PrintString(const CHAR16* str, uint32_t fg, uint32_t bg) {
    while (*str) PrintChar(*str++, fg, bg);
}

void PrintChar(CHAR16 c, uint32_t fg, uint32_t bg) {
    if (c == (CHAR16)'\n' || c == (CHAR16)'\r') {
        cursor_x = 0;
        cursor_y++;
    } else if (c == 0x08) { 
        if (cursor_x > 0) {
            cursor_x--;
        } else if (cursor_y > 0) {
            cursor_y--;
            cursor_x = console_cols - 1;
        }
        screen_buffer[cursor_y][cursor_x].Char = 0; 
    } else {
        screen_buffer[cursor_y][cursor_x].Char = c;
        screen_buffer[cursor_y][cursor_x].FG = fg;
        screen_buffer[cursor_y][cursor_x].BG = bg;
        cursor_x++;
    }

    if (cursor_x >= console_cols) {
        cursor_x = 0;
        cursor_y++;
    }
    if (cursor_y >= console_rows) {
        ScrollUp();
    }
}

void RenderConsole() {
    GfxClear(0x000000); 
    
    for (int y = 0; y < console_rows; y++) {
        CHAR16 line_buf[MAX_BUFFER_COLS + 1];
        uint32_t current_line_fg = screen_buffer[y][0].FG;

        for (int x = 0; x < console_cols; x++) {
            if (screen_buffer[y][x].BG != global_bg) {
                GfxDrawLine(OFFSET_X + (x * char_w), OFFSET_Y + (y * char_h), 
                            OFFSET_X + ((x + 1) * char_w), OFFSET_Y + (y * char_h), 
                            screen_buffer[y][x].BG);
            }
            line_buf[x] = screen_buffer[y][x].Char ? screen_buffer[y][x].Char : (CHAR16)' ';
        }
        line_buf[console_cols] = 0;
        
        GfxPrint(OFFSET_X, OFFSET_Y + (y * char_h), font_size, current_line_fg, line_buf);
    }

    uint32_t cursor_vis_x = OFFSET_X + (cursor_x * char_w);
    uint32_t cursor_vis_y = OFFSET_Y + (cursor_y * char_h) + (char_h - 2); 
    GfxDrawLine(cursor_vis_x, cursor_vis_y, cursor_vis_x + char_w, cursor_vis_y, 0xFFFFFF);
    
    SB(); 
}

CHAR16 ReadChar() {
    while (1) {
        if(KbdHasKey()) {
            CHAR16 c = (CHAR16)KbdGetKey(); 
            return c;
        }
    }
}

CHAR16* Read() {
    static CHAR16 buffer[256];
    int index = 0;

    while (1) {
        CHAR16 c = ReadChar();

        if (c == (CHAR16)'\n' || c == (CHAR16)'\r') {
            buffer[index] = 0;
            return buffer;
        } 
        else if (c == 0x08 || c == 127) { 
            if (index > 0) {
                index--;
                if (cursor_x > 0) {
                    cursor_x--;
                } else if (cursor_y > 0) {
                    cursor_y--;
                    cursor_x = console_cols - 1;
                }
                screen_buffer[cursor_y][cursor_x].Char = ' ';
                RenderConsole();
            }
        } 
        else if (index < 255) {
            buffer[index++] = c;
            PrintChar(c, global_fg, global_bg); 
            RenderConsole();
        }
    }
}

CHAR16* ReadLine() {
    CHAR16* line = Read();
    PrintChar((CHAR16)'\n', global_fg, global_bg);
    RenderConsole();
    return line;
}