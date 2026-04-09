#ifndef PARROT_VECTOR_H
#define PARROT_VECTOR_H

#include <stdint.h>
#include <stddef.h>

#if defined(__UEFI__) || defined(EFIAPI)
  #include <Library/UefiBootServicesTableLib.h>
  #include <Library/MemoryAllocationLib.h>
  
  static inline void* _v_malloc_internal(size_t sz) {
      void* p = NULL;
      gBS->AllocatePool(EfiLoaderData, sz, &p);
      return p;
  }
  #define V_ALLOC(sz) _v_malloc_internal(sz)
  #define V_FREE(p)    if(p) gBS->FreePool(p)
#else
  #include <stdlib.h>
  #define V_ALLOC(sz) malloc(sz)
  #define V_FREE(p)    free(p)
#endif

typedef struct {
    int32_t id;
    void* data;
} VectorItem;

struct Vector;

typedef void     (*vPush_t)(struct Vector* self, int32_t id, void* data);
typedef void* (*vGet_t) (struct Vector* self, int32_t id);
typedef uint8_t  (*vSet_t) (struct Vector* self, int32_t id, void* data);
typedef void* (*vAt_t)  (struct Vector* self, uint64_t idx);
typedef void     (*vRem_t) (struct Vector* self, int32_t id);
typedef uint64_t (*vCnt_t) (struct Vector* self);
typedef void     (*vClr_t) (struct Vector* self);

typedef struct Vector {
    VectorItem* items;
    uint64_t    size;
    uint64_t    capacity;

    vPush_t _push;
    vGet_t  _get;
    vSet_t  _set;
    vAt_t   _at;
    vRem_t  _rem;
    vCnt_t  _cnt;
    vClr_t  _clr;
} Vector;

#define Push(id, data) _push(&(prs), id, data)
#define GetById(id)    _get(&(prs), id)
#define SetById(id, d) _set(&(prs), id, d)
#define GetAt(idx)     _at(&(prs), idx)
#define Remove(id)     _rem(&(prs), id)
#define Count()        _cnt(&(prs))
#define Clear()        _clr(&(prs))


static void _v_push_impl(struct Vector* self, int32_t id, void* data) {
    if (self->size >= self->capacity) {
        uint64_t new_cap = (self->capacity == 0) ? 4 : self->capacity * 2;
        VectorItem* new_items = (VectorItem*)V_ALLOC(new_cap * sizeof(VectorItem));
        if (!new_items) return;
        for (uint64_t i = 0; i < self->size; i++) new_items[i] = self->items[i];
        if (self->items) V_FREE(self->items);
        self->items = new_items;
        self->capacity = new_cap;
    }
    self->items[self->size].id = id;
    self->items[self->size].data = data;
    self->size++;
}

static void* _v_get_impl(struct Vector* self, int32_t id) {
    if(!self->items) return NULL;
    for (uint64_t i = 0; i < self->size; i++) 
        if (self->items[i].id == id) return self->items[i].data;
    return NULL;
}

static uint8_t _v_set_impl(struct Vector* self, int32_t id, void* data) {
    if(!self->items) return 0;
    for (uint64_t i = 0; i < self->size; i++) {
        if (self->items[i].id == id) {
            self->items[i].data = data;
            return 1;
        }
    }
    return 0;
}

static void* _v_at_impl(struct Vector* self, uint64_t idx) {
    return (self->items && idx < self->size) ? self->items[idx].data : NULL;
}

static void _v_rem_impl(struct Vector* self, int32_t id) {
    if(!self->items) return;
    for (uint64_t i = 0; i < self->size; i++) {
        if (self->items[i].id == id) {
            for (uint64_t j = i; j < self->size - 1; j++) self->items[j] = self->items[j+1];
            self->size--;
            return;
        }
    }
}

static uint64_t _v_cnt_impl(struct Vector* self) { return self->size; }

static void _v_clr_impl(struct Vector* self) {
    if (self->items) V_FREE(self->items);
    self->items = NULL; self->size = 0; self->capacity = 0;
}

static inline void VectorInit(Vector* v, uint64_t initial_capacity) {
    v->size = 0;
    v->capacity = initial_capacity;
    v->items = (initial_capacity > 0) ? (VectorItem*)V_ALLOC(initial_capacity * sizeof(VectorItem)) : NULL;
    
    v->_push = _v_push_impl;
    v->_get  = _v_get_impl;
    v->_set  = _v_set_impl;
    v->_at   = _v_at_impl;
    v->_rem  = _v_rem_impl;
    v->_cnt  = _v_cnt_impl;
    v->_clr  = _v_clr_impl;
}

#endif