const CAPABILITY_FLAGS = {
    NONE: 0,
    READABLE: 1,
    WRITABLE: 2,
    DELETABLE: 4,
    TRUNCATABLE: 8,
    STATABLE: 16
};

export function makeCapabilityFlags(capabilities) {
    return Object.entries(capabilities).reduce((acc, [key, value]) => acc |= +value ? CAPABILITY_FLAGS[key.toUpperCase()] : 0, 0);
}

export function unmakeCapabilityFlags(capabilityFlags = {}) {
    return Object.entries(CAPABILITY_FLAGS).reduce((acc, [key, value]) => {
        if (capabilityFlags & value) acc[key.toLowerCase()] = true;
        return acc;
    }, {})
}