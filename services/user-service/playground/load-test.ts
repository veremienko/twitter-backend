import sharp from "sharp";

const port = 3004;
const baseUrl = `http://localhost:${port}`;
const internal = { 'x-internal-token': process.env.INTERNAL_TOKEN! };

const testImage = await sharp({
    create: {
        width: 4000,
        height: 4000,
        channels: 3,
        background: { r: 100, g: 150, b: 200 },
    },
})
    .png()
    .toBuffer();

async function createUser(email = `andrii-${Date.now()}@example.com`) {
    const res = await fetch(`${baseUrl}/users`, {
        method: 'POST',
        headers: { ...internal, 'content-type': 'application/json' },
        body: JSON.stringify({
            email,
            passwordHash: 'hash',
            name: 'Andrii',
            age: 30,
            sex: 'male',
        }),
    });
    return (await res.json()).id as number;
}

const upload = async (userId: number) => {
    const form = new FormData();
    form.append(
        'file',
        new Blob([Uint8Array.from(testImage)], { type: 'image/png' }),
        'c.png',
    );

        return fetch(`${baseUrl}/avatar`, {
            method: 'POST',
            headers: { ...internal, 'x-user-id': String(userId) },
            body: form,
        });
}


const userId = await createUser();



await Promise.all([
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId),
    upload(userId)
])

console.log('done');