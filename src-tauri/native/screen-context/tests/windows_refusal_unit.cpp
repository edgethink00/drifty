#define wmain unused_refusal_helper_main
#include "../windows.cpp"
#undef wmain

// Pure classification checks. No desktop, UIA, WGC, text or image access.
int wmain() {
    unsigned passed = 0;
    try {
        require_unchanged(true);
        ++passed;
        try {
            require_unchanged(false);
            return 2;
        } catch (Refusal const &error) {
            require(error.code == "changed");
            ++passed;
        }
        try {
            require(false);
            return 2;
        } catch (Refusal const &error) {
            require(error.code == "unavailable");
            ++passed;
        }
        Facts before;
        before.json = "synthetic-facts";
        for (int change = 0; change < 3; ++change) {
            Facts after = before;
            if (change == 0) after.json = "other-synthetic-facts";
            if (change == 1) after.activity_hint = true;
            if (change == 2) after.title_digest = "synthetic-title-digest";
            try {
                require_unchanged(sameFacts(before, after));
                return 2;
            } catch (Refusal const &error) {
                require(error.code == "changed");
                ++passed;
            }
        }
        std::cout << "{\"passed\":" << passed
                  << ",\"uiOrCaptureAccess\":false}";
        return passed == 6 ? 0 : 2;
    } catch (...) {
        return 2;
    }
}
