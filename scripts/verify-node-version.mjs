const requiredMajor = 24;
const requiredMinor = 19;
const [major, minor] = process.versions.node.split('.').map(Number);

const supported = major === requiredMajor && minor >= requiredMinor;

if (!supported) {
    console.error(
        `Unsupported Node.js ${process.versions.node}. `
        + `WP MONITOR requires Node.js >=${requiredMajor}.${requiredMinor}.0 <25.`,
    );
    process.exit(1);
}

console.log(`Node.js ${process.versions.node} is supported.`);
