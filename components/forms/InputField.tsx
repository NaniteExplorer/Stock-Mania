"use client";

import React, { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import {Label} from "@/components/ui/label";
import {Input} from "@/components/ui/input";
import {cn} from "@/lib/utils";

const InputField = ({
  name,
  label,
  placeholder,
  type = "text",
  register,
  error,
  validation,
  disabled,
  value,
}: FormInputProps) => {
  const isPassword = type === "password";
  const [visible, setVisible] = useState(false);

  return (
    <div className={"space-y-2"}>
      <Label htmlFor={name} className="form-label">
        {label}
      </Label>
      <div className="relative">
        <Input
          type={isPassword && visible ? "text" : type}
          id={name}
          placeholder={placeholder}
          value={value}
          className={cn("form-input", {
            "opacity-50 cursor-not-allowed": disabled,
            "pr-10": isPassword,
          })}
          {...register(name, validation)}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? "Hide password" : "Show password"}
            aria-pressed={visible}
            aria-controls={name}
            disabled={disabled}
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-gray-500 hover:text-gray-300 focus-visible:outline-2 focus-visible:outline-offset-[-2px] rounded-r-md"
          >
            {visible ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
          </button>
        )}
      </div>
      {error && <p className={"text-sm text-red-500"}>{error.message}</p>}
    </div>
  );
};

export default InputField;
