import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  // 정적 JSON 50k+ 파일이 Serverless Function bundle 안 inline 되는 것 회피.
  // 모든 페이지가 SSG/static 이라 정적 자산은 public/ 으로 직접 호스팅됨.
  outputFileTracingExcludes: {
    "*": ["./public/data/static/**"],
  },
};

export default nextConfig;
