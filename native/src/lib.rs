//! N-API bindings for Embedded Streamline.
//!
//! Wraps the Streamline C FFI (`libstreamline`) into a Node.js native module
//! using napi-rs. This allows the `EmbeddedStreamline` TypeScript class to
//! run Streamline in-process without a separate server.
//!
//! # Building
//!
//! ```bash
//! # Ensure libstreamline is built first:
//! cd ../../../streamline && cargo build --release --lib
//!
//! # Then build the native module:
//! cd ../native && npm run build
//! ```

use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::ffi::{CStr, CString};
use std::os::raw::c_char;
use std::ptr;

// C FFI declarations — these link against libstreamline.dylib/.so
extern "C" {
    fn streamline_open_in_memory() -> *mut std::ffi::c_void;
    fn streamline_close(handle: *mut std::ffi::c_void);
    fn streamline_create_topic(
        handle: *mut std::ffi::c_void,
        name: *const c_char,
        partitions: i32,
    ) -> i32;
    fn streamline_produce(
        handle: *mut std::ffi::c_void,
        topic: *const c_char,
        partition: i32,
        key: *const u8,
        key_len: u32,
        value: *const u8,
        value_len: u32,
    ) -> i64;
    fn streamline_last_error() -> *const c_char;
    fn streamline_version() -> *const c_char;
}

fn last_error() -> String {
    unsafe {
        let ptr = streamline_last_error();
        if ptr.is_null() {
            "unknown error".to_string()
        } else {
            CStr::from_ptr(ptr).to_string_lossy().into_owned()
        }
    }
}

/// Embedded Streamline instance accessible from Node.js.
#[napi]
pub struct EmbeddedStreamline {
    handle: *mut std::ffi::c_void,
}

#[napi]
impl EmbeddedStreamline {
    /// Create a new in-memory Streamline instance.
    #[napi(constructor)]
    pub fn new() -> Result<Self> {
        let handle = unsafe { streamline_open_in_memory() };
        if handle.is_null() {
            return Err(Error::from_reason(format!(
                "Failed to create Streamline instance: {}",
                last_error()
            )));
        }
        Ok(Self { handle })
    }

    /// Create a topic with the given number of partitions.
    #[napi]
    pub fn create_topic(&self, name: String, partitions: i32) -> Result<()> {
        let c_name = CString::new(name).map_err(|e| Error::from_reason(e.to_string()))?;
        let result = unsafe { streamline_create_topic(self.handle, c_name.as_ptr(), partitions) };
        if result != 0 {
            return Err(Error::from_reason(format!(
                "Failed to create topic: {}",
                last_error()
            )));
        }
        Ok(())
    }

    /// Produce a message to a topic.
    #[napi]
    pub fn produce(
        &self,
        topic: String,
        value: Buffer,
        key: Option<Buffer>,
    ) -> Result<i64> {
        let c_topic = CString::new(topic).map_err(|e| Error::from_reason(e.to_string()))?;
        let (key_ptr, key_len) = match &key {
            Some(k) => (k.as_ptr(), k.len() as u32),
            None => (ptr::null(), 0),
        };
        let offset = unsafe {
            streamline_produce(
                self.handle,
                c_topic.as_ptr(),
                0,
                key_ptr,
                key_len,
                value.as_ptr(),
                value.len() as u32,
            )
        };
        if offset < 0 {
            return Err(Error::from_reason(format!(
                "Produce failed: {}",
                last_error()
            )));
        }
        Ok(offset)
    }

    /// Get the Streamline version.
    #[napi]
    pub fn version() -> String {
        unsafe {
            let ptr = streamline_version();
            if ptr.is_null() {
                "unknown".to_string()
            } else {
                CStr::from_ptr(ptr).to_string_lossy().into_owned()
            }
        }
    }

    /// Close the instance and free resources.
    #[napi]
    pub fn close(&mut self) {
        if !self.handle.is_null() {
            unsafe { streamline_close(self.handle) };
            self.handle = ptr::null_mut();
        }
    }
}

impl Drop for EmbeddedStreamline {
    fn drop(&mut self) {
        self.close();
    }
}

// Safety: The FFI handle is thread-safe (uses Arc internally)
unsafe impl Send for EmbeddedStreamline {}
