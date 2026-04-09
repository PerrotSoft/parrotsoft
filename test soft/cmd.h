#pragma once
#include "ParrotOS_API.h"
#include "console.h"

static uint8_t echo = 1;

// --- Система переменных EOS ---
#define MAX_VARS 30
#define VAR_NAME_LEN 32
#define VAR_VAL_LEN 256

typedef struct {
    CHAR16 name[VAR_NAME_LEN];
    CHAR16 value[VAR_VAL_LEN];
    bool active;
} Variable;

static Variable env_vars[MAX_VARS];

// --- Вспомогательные функции ---

static inline size_t wcslen(const CHAR16* s) {
    size_t len = 0;
    while (s && s[len]) len++;
    return len;
}
unsigned long wcstoul(const CHAR16* nptr, CHAR16** endptr, int base) {
    unsigned long res = 0;
    const CHAR16* p = nptr;

    // Пропускаем возможные пробелы
    while (*p == L' ') p++;

    // Простейшая логика для базы 10
    while (*p >= L'0' && *p <= L'9') {
        res = res * 10 + (*p - L'0');
        p++;
    }

    if (endptr) *endptr = (CHAR16*)p;
    return res;
}
static inline int wcscmp(const CHAR16* s1, const CHAR16* s2) {
    while (*s1 && (*s1 == *s2)) { s1++; s2++; }
    return (int)(*s1 - *s2);
}

static inline CHAR16* wcstok(CHAR16* str, const CHAR16* delim, CHAR16** ptr) {
    if (str == NULL) str = *ptr;
    if (str == NULL || *str == 0) return NULL;
    while (*str && *str == *delim) str++;
    if (*str == 0) return NULL;
    CHAR16* start = str;
    while (*str && *str != *delim) str++;
    if (*str) { *str = 0; *ptr = str + 1; } 
    else { *ptr = NULL; }
    return start;
}

static inline CHAR16* GetFullArg(CHAR16* command) {
    if (!command) return (CHAR16*)L"";
    while (*command && *command != L' ') command++;
    while (*command && *command == L' ') command++;
    return command;
}

// --- Управление переменными ---

void SetVar(const CHAR16* name, const CHAR16* value) {
    if (!name || !value) return;
    for (int i = 0; i < MAX_VARS; i++) {
        if (env_vars[i].active && wcscmp(env_vars[i].name, name) == 0) {
            int j = 0;
            for(; value[j] && j < VAR_VAL_LEN - 1; j++) env_vars[i].value[j] = value[j];
            env_vars[i].value[j] = 0;
            return;
        }
    }
    for (int i = 0; i < MAX_VARS; i++) {
        if (!env_vars[i].active) {
            env_vars[i].active = true;
            int j = 0;
            for(; name[j] && j < VAR_NAME_LEN - 1; j++) env_vars[i].name[j] = name[j];
            env_vars[i].name[j] = 0;
            for(j = 0; value[j] && j < VAR_VAL_LEN - 1; j++) env_vars[i].value[j] = value[j];
            env_vars[i].value[j] = 0;
            return;
        }
    }
}

CHAR16* GetVar(const CHAR16* name) {
    for (int i = 0; i < MAX_VARS; i++) {
        if (env_vars[i].active && wcscmp(env_vars[i].name, name) == 0) return env_vars[i].value;
    }
    return (CHAR16*)L"";
}

// --- НОВЫЙ ПАРСЕР АРГУМЕНТОВ ---

static inline void ResolvePreProcessor(CHAR16** argv, int argc) {
    for (int i = 0; i < argc; i++) {
        // Проверяем каждый символ в каждом аргументе
        for (int j = 0; argv[i][j] != 0; j++) {
            // Если находим $$ внутри любого аргумента
            if (argv[i][j] == '$' && argv[i][j+1] == '$') {
                CHAR16* var_val = GetVar(argv[i] + j + 2);
                if (var_val) {
                    argv[i] = var_val; // Заменяем весь аргумент на значение переменной
                    break; 
                }
            }
        }
    }
}

static inline CHAR16* CmdRun(CHAR16* command) {
    if (!command || command[0] == 0) return (CHAR16*)L"";

    // 1. Silent capture ($var cmd)
    CHAR16* var_capture = NULL;
    if (command[0] == '$' && command[1] != '$') {
        CHAR16* saveptr;
        var_capture = wcstok(command + 1, L" ", &saveptr);
        command = saveptr;
    }

    // 2. Разбивка на токены
    CHAR16* argv[15];
    int argc = 0;
    static CHAR16 split_buf[256];
    for(int i=0; i<256; i++) { split_buf[i] = command[i]; if(!command[i]) break; }
    
    CHAR16* ptr;
    CHAR16* token = wcstok(split_buf, L" ", &ptr);
    while (token && argc < 15) {
        argv[argc++] = token;
        token = wcstok(NULL, L" ", &ptr);
    }

    if (argc == 0) return (CHAR16*)L"";

    // 3. ПОЛНАЯ ПРОВЕРКА ВСЕХ АРГУМЕНТОВ
    ResolvePreProcessor(argv, argc);

    CHAR16* result = (CHAR16*)L"";

    // --- ЛОГИКА КОМАНД ---

    if (wcscmp(argv[0], L"if") == 0) {
        if (argc >= 5 && wcscmp(argv[2], L"==") == 0) {
            // Сравнение уже подставленных значений аргументов 1 и 3
            if (wcscmp(argv[1], argv[3]) == 0) {
                result = CmdRun(GetFullArg(GetFullArg(GetFullArg(GetFullArg(command)))));
            } else {
                for(int i = 4; i < argc; i++) {
                    if (wcscmp(argv[i], L"else") == 0 && (i + 1) < argc) {
                        CHAR16* rest = GetFullArg(command);
                        for(int k=0; k < i; k++) rest = GetFullArg(rest);
                        result = CmdRun(rest);
                        break;
                    }
                }
            }
        }
        return result; 
    }
    
    if (wcscmp(argv[0], L"ls") == 0) {
        CHAR16* listing = FsListDir();
        if (listing) {
            result = listing;
        } else {
            result = (CHAR16*)L"Error: Unable to list directory.";
        }
    }
else if (wcscmp(argv[0], L"cat") == 0) {
    if (argc >= 2) {
        CHAR16* content = NULL; // Тип теперь совпадает с ожиданиями FileRead
        uint64_t size = 0;
        
        // Теперь &content имеет тип CHAR16**, что и нужно функции
        if (FileRead(argv[1], &content, &size) == 0 && size > 0) {
            static CHAR16 cat_output[1024];
            uint64_t bytes_to_copy = (size < 2046) ? size : 2046;
            
            for(uint64_t i = 0; i < bytes_to_copy; i++) {
                ((uint8_t*)cat_output)[i] = ((uint8_t*)content)[i];
            }
            
            cat_output[bytes_to_copy / 2] = 0; 
            result = cat_output;
        } else {
            result = (CHAR16*)L"Error: File is empty or not found.";
        }
    } else {
        result = (CHAR16*)L"Usage: cat <filename>";
    }
}
    else if (wcscmp(argv[0], L"help") == 0) {
        result = (CHAR16*)L"Available commands:\n"
                            L"ls - List directory\n"
                            L"cat <file> - Display file contents\n"
                            L"set <var> <value> - Set variable\n"
                            L"echo [on|off|text] - Toggle or set echo\n"
                            L"screen <w> <h> - Change screen mode\n"
                            L"clear - Clear console\n"
                            L"if <a> == <b> <cmd> [else <cmd>] - Conditional execution";
    }
    else if (wcscmp(argv[0], L"set") == 0) {
        if (argc >= 3) SetVar(argv[1], GetFullArg(GetFullArg(command)));
        return (CHAR16*)L"done";
    }
    else if (wcscmp(argv[0], L"echo") == 0) {
        if (argc > 1) {
            if (wcscmp(argv[1], L"off") == 0) { echo = 0; return (CHAR16*)L""; }
            if (wcscmp(argv[1], L"on") == 0)  { echo = 1; return (CHAR16*)L"done"; }
            
            // Запись текста в файл
            if (wcscmp(argv[1], L"setfile") == 0 && argc >= 4) {
                CHAR16* fileName = argv[2];
                // Получаем весь текст после имени файла
                CHAR16* textToWrite = GetFullArg(GetFullArg(GetFullArg(command)));
                
                // Считаем размер: количество символов * 2 байта
                uint64_t dataSize = wcslen(textToWrite) * sizeof(CHAR16);
                
                if (FileWrite(fileName, textToWrite, dataSize) == 0) {
                    return (CHAR16*)L"File saved.";
                } else {
                    return (CHAR16*)L"Error: Write failed.";
                }
            }
            
            // Обычный вывод текста в консоль
            static CHAR16 echo_buf[256];
            int pos = 0;
            for (int i = 1; i < argc; i++) {
                CHAR16* arg = argv[i];
                for (int j = 0; arg[j] != 0 && pos < 254; j++) echo_buf[pos++] = arg[j];
                if (i < argc - 1 && pos < 254) echo_buf[pos++] = L' ';
            }
            echo_buf[pos] = 0;
            result = echo_buf;
        }
    }
    else if (wcscmp(argv[0], L"screen") == 0) {
        if (argc >= 3) {
            uint32_t new_w = (uint32_t)wcstoul(argv[1], NULL, 10);
            uint32_t new_h = (uint32_t)wcstoul(argv[2], NULL, 10);
            
            if (new_w > 0 && new_h > 0) {
                ConsoleInit(new_w, new_h); 
                ConsoleClear();
                RenderConsole();
                return (CHAR16*)L"Screen mode updated";
            }
        }
        return (CHAR16*)L"Usage: screen <width> <height>";
    }
    else if (wcscmp(argv[0], L"clear") == 0) {
        ConsoleClear();
        RenderConsole();
        return (CHAR16*)L"done";
    }
    else {
        result = (CHAR16*)L"Error: Command not found.";
    }

    if (var_capture) {
        SetVar(var_capture, result);
        return (CHAR16*)L"";
    }
    return result;
}

static inline void Cmd() {
    while (1) {
        if (echo) {
            PrintString(L"root@parrot:~$ ", 0x00FF7F, 0x000000);
            RenderConsole();
        }
        CHAR16* input = ReadLine(); 
        CHAR16* output = CmdRun(input);

        if (output && output[0] != 0) {
            PrintString(output, 0xFFFFFF, 0x000000);
            PrintChar(L'\n', 0xFFFFFF, 0x000000);
            RenderConsole();
        }
    }
}