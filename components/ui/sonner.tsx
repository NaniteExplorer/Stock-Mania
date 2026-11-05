"use client";


import { Toaster as SoonerToaster, type ToasterProps } from "sonner";
import { Icon } from "../icons";
import { Spinner } from "./spinner";
import styles from "./feedback.module.css";
import React from "react";

const Toaster = ({ ...props }: ToasterProps) => {
  

  return (
    <SoonerToaster
      theme="system"
      className="toaster group"
      position="top-center"
      closeButton
      icons={{
        success: <Icon name="check" />,
        info: <Icon name="info" />,
        warning: <Icon name="warn" />,
        error: <Icon name="warn" />,
        loading: <Spinner />,
      }}
      style={
        {
          "--normal-bg": "var(--bg-raised)",
          "--normal-text": "var(--fg)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--r-3)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: styles.toast,
          success: styles.toastSuccess,
          warning: styles.toastWarning,
          error: styles.toastError,
          info: styles.toastInfo,
          description: styles.description,
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
