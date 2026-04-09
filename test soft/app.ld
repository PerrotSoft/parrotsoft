OUTPUT_FORMAT("binary")
ENTRY(_start)
SECTIONS
{
    . = 0x0;
    .text : {
        *(.text.boot)    /* Наш _start из библиотеки */
        *(.text)         /* Весь остальной код */
    }
    .data : { *(.data) *(.rodata*) }
    .bss  : { *(.bss)  }
}