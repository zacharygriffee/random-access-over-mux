export function handleCallback(resolve, reject) {
    return (err, value) => err ? reject(err) : resolve(value)
}