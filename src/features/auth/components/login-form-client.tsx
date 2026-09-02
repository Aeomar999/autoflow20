"use client";

import dynamic from "next/dynamic";

const LoginForm = dynamic(
  () =>
    import("@/features/auth/components/login-form").then((mod) => ({
      default: mod.LoginForm,
    })),
  { ssr: false },
);

export default LoginForm;
