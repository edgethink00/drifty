//! Type-checked reads of values other apps return through the Accessibility
//! API.
//!
//! `AXUIElementCopyAttributeValue` returns whatever CF object the target app
//! chose. Reading a number as a `CFString` or a string as a `CFArray` does
//! not fail softly: CoreFoundation either traps on the type mismatch or sends
//! an unrecognized selector, whose Objective-C exception aborts a Rust
//! process ("Rust cannot catch foreign exceptions"). A single unusual app
//! under the desktop pet could therefore end Drifty. Every value is checked
//! against its CF type ID before it is interpreted.

use core_foundation::array::CFArray;
use core_foundation::base::{CFType, CFTypeID, CFTypeRef, TCFType};
use core_foundation::string::CFString;
use std::ffi::c_void;

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXUIElementGetTypeID() -> CFTypeID;
    fn AXValueGetTypeID() -> CFTypeID;
}

fn type_id_of(value: *const c_void) -> Option<CFTypeID> {
    // SAFETY: callers pass a live CF object (or null, handled here);
    // wrap_under_get_rule retains it for the duration of the read.
    (!value.is_null()).then(|| unsafe { CFType::wrap_under_get_rule(value as CFTypeRef) }.type_of())
}

/// Takes ownership of a copied value and returns it only if it is a string.
///
/// # Safety
/// `value` must be a live CF object the caller owns (Create/Copy rule).
pub(crate) unsafe fn owned_string(value: CFTypeRef) -> Option<String> {
    CFType::wrap_under_create_rule(value)
        .downcast_into::<CFString>()
        .map(|string| string.to_string())
}

/// Takes ownership of a copied value and returns it only if it is an array.
///
/// # Safety
/// `value` must be a live CF object the caller owns (Create/Copy rule).
pub(crate) unsafe fn owned_array(value: CFTypeRef) -> Option<CFArray<*const c_void>> {
    CFType::wrap_under_create_rule(value).downcast_into::<CFArray<*const c_void>>()
}

/// Whether `value` is an `AXUIElementRef` that AX calls may be made on.
pub(crate) fn is_ax_element(value: *const c_void) -> bool {
    type_id_of(value) == Some(unsafe { AXUIElementGetTypeID() })
}

/// Whether `value` is an `AXValueRef` that `AXValueGetValue` may read.
pub(crate) fn is_ax_value(value: *const c_void) -> bool {
    type_id_of(value) == Some(unsafe { AXValueGetTypeID() })
}

/// Element access for arrays such as `AXWindows` and `AXChildren` that
/// yields only real AX elements.
pub(crate) trait AxElements {
    fn ax_element(&self, index: isize) -> Option<*const c_void>;
}

impl AxElements for CFArray<*const c_void> {
    fn ax_element(&self, index: isize) -> Option<*const c_void> {
        let value = *self.get(index)?;
        is_ax_element(value).then_some(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core_foundation::base::CFRetain;
    use core_foundation::number::CFNumber;

    /// A +1 reference the callee owns, like an AX Copy-rule result.
    fn copy_of(value: &impl TCFType) -> CFTypeRef {
        unsafe { CFRetain(value.as_CFTypeRef()) }
    }

    #[test]
    fn a_number_where_a_string_or_array_was_expected_is_rejected_without_crashing() {
        // Unchecked, CFString::to_string on this number throws an
        // Objective-C "unrecognized selector" exception and aborts.
        let number = CFNumber::from(42i32);
        assert_eq!(unsafe { owned_string(copy_of(&number)) }, None);
        assert!(unsafe { owned_array(copy_of(&number)) }.is_none());
        assert!(!is_ax_element(number.as_CFTypeRef()));
        assert!(!is_ax_value(number.as_CFTypeRef()));
        assert!(!is_ax_element(std::ptr::null()));
    }

    #[test]
    fn matching_values_are_read_and_non_elements_are_skipped() {
        let string = CFString::new("AXWindow");
        assert_eq!(
            unsafe { owned_string(copy_of(&string)) }.as_deref(),
            Some("AXWindow")
        );

        // An AXChildren-style array holding something that is not an element.
        let array = CFArray::from_CFTypes(&[string.as_CFType()]);
        let untyped = unsafe { owned_array(copy_of(&array)) }.expect("an array");
        assert_eq!(untyped.len(), 1);
        assert_eq!(untyped.ax_element(0), None);
        assert_eq!(untyped.ax_element(1), None);
    }
}
