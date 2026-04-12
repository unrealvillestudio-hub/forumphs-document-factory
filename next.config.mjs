/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['mammoth', 'docx', 'xlsx'],
    serverActions: {
      bodySizeLimit: '50mb'
    }
  },
}

export default nextConfig
