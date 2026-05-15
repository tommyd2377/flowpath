import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="flex min-h-[65vh] items-center justify-center py-10">
      <SignUp path="/sign-up" routing="path" signInUrl="/sign-in" />
    </div>
  );
}
